"""API regression tests; downloading is mocked, text extraction is real."""

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app


class WebsiteExtractionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(os.environ, {"DEEP_WEBSEARCH_TOKEN": "test-token"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = TestClient(app, headers={"X-Backend-Token": "test-token"})
        self.addCleanup(self.client.close)

    def test_extracts_real_article_text_without_boilerplate(self) -> None:
        html = (Path(__file__).parent / "fixtures" / "article.html").read_text()
        with patch("backend.app.fetch_url", return_value=html) as download:
            response = self.client.post("/extract", json={"url": "https://example.com/article"})

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["url"], "https://example.com/article")
        self.assertIn("The reader stays in control", result["text"])
        self.assertIn("café, বাংলা, and naïve", result["text"])
        self.assertIn("\n", result["text"])
        for unwanted in ("NAVIGATION_ONLY", "FOOTER_ONLY", "COMMENT_ONLY", "<p>"):
            self.assertNotIn(unwanted, result["text"])
        self.assertEqual(download.call_args.args[0], result["url"])

    def test_requires_valid_desktop_token_before_downloading(self) -> None:
        with patch("backend.app.fetch_url") as download:
            for headers in ({}, {"X-Backend-Token": "wrong-token"}):
                with self.subTest(headers=headers), TestClient(app) as client:
                    response = client.post("/extract", headers=headers, json={"url": "https://example.com"})
                    self.assertEqual(response.status_code, 401)
            download.assert_not_called()

    def test_missing_server_token_is_unauthorized(self) -> None:
        with patch.dict(os.environ, {"DEEP_WEBSEARCH_TOKEN": ""}):
            response = self.client.post("/extract", json={"url": "https://example.com"})
        self.assertEqual(response.status_code, 401)

    def test_rejects_invalid_urls_before_downloading(self) -> None:
        with patch("backend.app.fetch_url") as download:
            for url in ("", "not a url", "example.com", "ftp://example.com/article", "file:///etc/passwd"):
                with self.subTest(url=url):
                    response = self.client.post("/extract", json={"url": url})
                    self.assertEqual(response.status_code, 422)
            download.assert_not_called()
        self.assertEqual(self.client.post("/extract", json={}).status_code, 422)

    def test_download_failure_has_actionable_error(self) -> None:
        with patch("backend.app.fetch_url", return_value=None), patch("backend.app.extract") as extract:
            response = self.client.post("/extract", json={"url": "https://example.com"})
            extract.assert_not_called()
        self.assertEqual(response.status_code, 502)
        self.assertIn("Could not fetch", response.json()["detail"])

    def test_download_exception_does_not_expose_internal_details(self) -> None:
        with patch("backend.app.fetch_url", side_effect=RuntimeError("internal detail")), self.assertLogs("backend.app", level="ERROR"):
            response = self.client.post("/extract", json={"url": "https://example.com"})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("internal detail", response.json()["detail"])

    def test_no_readable_text_has_actionable_error(self) -> None:
        with patch("backend.app.fetch_url", return_value="<html></html>"):
            for result in (None, "   \n"):
                with self.subTest(result=result), patch("backend.app.extract", return_value=result):
                    response = self.client.post("/extract", json={"url": "https://example.com"})
                    self.assertEqual(response.status_code, 422)
                    self.assertIn("No readable article text", response.json()["detail"])

    def test_extraction_exception_has_readable_error(self) -> None:
        with patch("backend.app.fetch_url", return_value="<html></html>"), patch("backend.app.extract", side_effect=RuntimeError("internal detail")), self.assertLogs("backend.app", level="ERROR"):
            response = self.client.post("/extract", json={"url": "https://example.com"})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("internal detail", response.json()["detail"])

    def test_health_route_still_works(self) -> None:
        self.assertEqual(self.client.get("/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
