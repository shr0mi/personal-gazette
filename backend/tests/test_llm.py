"""Model routing, response validation, and credential handling regressions."""

import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient

from backend.app import app
from backend.llm import LLMSettings


class AuthenticationError(Exception):
    pass


class ContextError(Exception):
    pass


class RateLimitError(Exception):
    pass


class TimeoutError(Exception):
    pass


class ConnectionError(Exception):
    pass


def model_response(content=None, finish_reason="stop"):
    if content is None:
        content = json.dumps({"title": "A clearer view of the article", "summary": "A concise article summary.", "key_points": ["First fact.", "Second fact.", "Third fact."]})
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish_reason, message=SimpleNamespace(content=content))])


class ModelTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"DEEP_WEBSEARCH_TOKEN": "test-token"})
        environment.start()
        self.addCleanup(environment.stop)
        self.client = TestClient(app, headers={"X-Backend-Token": "test-token"})
        self.addCleanup(self.client.close)
        self.sdk = SimpleNamespace(
            completion=Mock(return_value=model_response()),
            AuthenticationError=AuthenticationError,
            ContextWindowExceededError=ContextError,
            RateLimitError=RateLimitError,
            Timeout=TimeoutError,
            APIConnectionError=ConnectionError,
        )
        sdk_patch = patch("backend.llm.get_litellm", return_value=self.sdk)
        sdk_patch.start()
        self.addCleanup(sdk_patch.stop)
        self.local = {"mode": "local", "provider": "llama_cpp", "model": "my-model", "base_url": "8080"}

    def summarize(self, settings=None, text="The edited article text."):
        return self.client.post("/summarize", json={"text": text, "settings": settings or self.local})

    def test_local_routing_uses_edited_text_and_json_mode(self):
        response = self.summarize(text="My correction: the event was in 2025.")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "A clearer view of the article")
        self.assertEqual(response.json()["key_points"], ["First fact.", "Second fact.", "Third fact."])
        options = self.sdk.completion.call_args.kwargs
        self.assertEqual(options["model"], "openai/my-model")
        self.assertEqual(options["api_base"], "http://127.0.0.1:8080/v1")
        self.assertEqual(options["api_key"], "local-no-key-required")
        self.assertEqual(options["response_format"], {"type": "json_object"})
        self.assertIn("My correction: the event was in 2025.", options["messages"][1]["content"])
        self.assertIn("title (a short, informative", options["messages"][0]["content"])
        self.assertIn("same language as the article", options["messages"][0]["content"])
        self.assertEqual(options["num_retries"], 0)
        self.assertEqual(response.json()["mode"], "local")

    def test_ollama_uses_chat_provider_and_root_url(self):
        settings = {**self.local, "provider": "ollama", "model": "qwen:8b", "base_url": "http://localhost:11434/v1/"}
        self.assertEqual(self.summarize(settings).status_code, 200)
        options = self.sdk.completion.call_args.kwargs
        self.assertEqual(options["model"], "ollama_chat/qwen:8b")
        self.assertEqual(options["api_base"], "http://localhost:11434")

    def test_cloud_provider_routing_and_explicit_credentials(self):
        for provider in ("openai", "anthropic", "gemini", "openrouter", "azure", "custom"):
            with self.subTest(provider=provider):
                settings = {"mode": "cloud", "provider": provider, "model": "vendor/model" if provider == "openrouter" else "test-model", "api_key": "private-test-key"}
                if provider in {"azure", "custom"}:
                    settings["base_url"] = "https://provider.example/v1"
                if provider == "azure":
                    settings["api_version"] = "test-version"
                response = self.summarize(settings)
                self.assertEqual(response.status_code, 200)
                options = self.sdk.completion.call_args.kwargs
                prefix = "openai" if provider == "custom" else provider
                self.assertEqual(options["model"], f'{prefix}/{settings["model"]}')
                self.assertEqual(options["api_key"], "private-test-key")
                self.assertNotIn("private-test-key", response.text)
                if provider == "azure":
                    self.assertEqual(options["api_version"], "test-version")

    def test_rejects_invalid_settings_without_exposing_keys(self):
        invalid = [
            {**self.local, "base_url": "https://remote.example/v1"},
            {**self.local, "base_url": "http://127.0.0.1:0"},
            {**self.local, "base_url": "http://127.0.0.1:8080/v1/chat/completions"},
            {**self.local, "provider": "openai"},
            {"mode": "cloud", "provider": "openai", "model": "test-model"},
            {"mode": "cloud", "provider": "azure", "model": "test-model", "api_key": "private-test-key"},
            {"mode": "cloud", "provider": "custom", "model": "test-model", "api_key": "private-test-key", "base_url": "http://remote.example/v1"},
        ]
        for settings in invalid:
            with self.subTest(settings=settings):
                response = self.summarize(settings)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("private-test-key", response.text)
        self.sdk.completion.assert_not_called()

    def test_authentication_is_required_for_both_routes(self):
        with TestClient(app) as client:
            self.assertEqual(client.post("/summarize", json={"text": "Article", "settings": self.local}).status_code, 401)
            self.assertEqual(client.post("/llm/models", json=self.local).status_code, 401)
        self.sdk.completion.assert_not_called()

    def test_empty_or_oversized_article_and_missing_model_are_rejected(self):
        for text in ("", "  \n", "x" * 200_001):
            with self.subTest(length=len(text)):
                self.assertEqual(self.summarize(text=text).status_code, 422)
        self.assertEqual(self.summarize({**self.local, "model": ""}).status_code, 422)
        self.sdk.completion.assert_not_called()

    def test_json_fences_and_thinking_are_handled(self):
        content = '<think>Some private reasoning.</think>\n```json\n{"title":"  পাঠকের   নিজের নিয়ন্ত্রণ  ","summary":"  Useful summary. ","key_points":[" Fact. "]}\n```'
        self.sdk.completion.return_value = model_response(content)
        result = self.summarize().json()
        self.assertEqual(result["title"], "পাঠকের নিজের নিয়ন্ত্রণ")
        self.assertEqual(result["summary"], "Useful summary.")
        self.assertEqual(result["key_points"], ["Fact."])

    def test_malformed_empty_or_truncated_outputs_fail_cleanly(self):
        for content in ("Not JSON", '{"title":"Heading","summary":"","key_points":["fact"]}', '{"title":"Heading","summary":"summary","key_points":[]}', '{"title":"Heading","summary":"summary","key_points":[""]}'):
            with self.subTest(content=content):
                self.sdk.completion.return_value = model_response(content)
                self.assertEqual(self.summarize().status_code, 502)
        self.sdk.completion.return_value = model_response(finish_reason="length")
        self.assertEqual(self.summarize().status_code, 502)

    def test_missing_empty_or_oversized_headings_fail_cleanly(self):
        valid = {"summary": "A summary.", "key_points": ["A fact."]}
        for title in (None, "", " \n\t ", "x" * 201, 123, ["Heading"]):
            with self.subTest(title=title):
                self.sdk.completion.return_value = model_response(json.dumps({**valid, "title": title}))
                response = self.summarize()
                self.assertEqual(response.status_code, 502)
                self.assertIn("heading", response.json()["detail"])
        self.sdk.completion.return_value = model_response(json.dumps(valid))
        self.assertEqual(self.summarize().status_code, 502)
        self.sdk.completion.return_value = model_response(json.dumps({**valid, "title": "x" * 200}))
        self.assertEqual(self.summarize().status_code, 200)

    def test_provider_failures_are_actionable_and_do_not_leak_secrets(self):
        for error, status in ((AuthenticationError, 502), (ContextError, 422), (RateLimitError, 429), (TimeoutError, 504), (ConnectionError, 502), (RuntimeError, 502)):
            with self.subTest(error=error):
                self.sdk.completion.side_effect = error("private-test-key and article content")
                response = self.summarize()
                self.assertEqual(response.status_code, status)
                self.assertNotIn("private-test-key", response.text)
                self.assertNotIn("article content", response.text)

    def test_discovers_llama_and_ollama_models(self):
        actual_client = httpx.Client
        for provider, payload, path in (
            ("llama_cpp", {"data": [{"id": "loaded-model"}]}, "/v1/models"),
            ("ollama", {"models": [{"name": "qwen:8b"}]}, "/api/tags"),
        ):
            with self.subTest(provider=provider):
                def respond(request):
                    self.assertEqual(request.url.path, path)
                    self.assertEqual(request.headers["Authorization"], "Bearer local-secret")
                    return httpx.Response(200, json=payload)
                with patch("backend.llm.httpx.Client", return_value=actual_client(transport=httpx.MockTransport(respond))):
                    response = self.client.post("/llm/models", json={**self.local, "provider": provider, "api_key": "local-secret"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()["models"]), 1)
                self.assertNotIn("local-secret", response.text)

    def test_empty_or_unavailable_local_server_has_readable_error(self):
        actual_client = httpx.Client
        for status, payload, expected in ((200, {"data": []}, 422), (401, {}, 502), (404, {}, 502)):
            with self.subTest(status=status):
                transport = httpx.MockTransport(lambda _: httpx.Response(status, json=payload))
                with patch("backend.llm.httpx.Client", return_value=actual_client(transport=transport)):
                    response = self.client.post("/llm/models", json=self.local)
                self.assertEqual(response.status_code, expected)

    def test_keys_are_redacted_in_model_representation(self):
        settings = LLMSettings(**{**self.local, "api_key": "private-test-key"})
        self.assertNotIn("private-test-key", repr(settings))

    def test_runtime_initialization_failure_has_readable_error(self):
        with patch("backend.llm.get_litellm", side_effect=RuntimeError("private-test-key")):
            response = self.summarize()
        self.assertEqual(response.status_code, 503)
        self.assertIn("runtime could not start", response.json()["detail"])
        self.assertNotIn("private-test-key", response.text)


if __name__ == "__main__":
    unittest.main()
