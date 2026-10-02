import { useId, useState, type ComponentProps, type MouseEvent } from "react";
import { openExternalLink } from "./externalLinks";

type Props = Omit<ComponentProps<"a">, "href" | "onClick" | "onAuxClick"> & { href: string };

export default function ExternalLink({ href, children, ...props }: Props) {
  const [error, setError] = useState(false);
  const errorId = useId();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    setError(false);
    void openExternalLink(event, href).catch(() => setError(true));
  };

  return (
    <>
      <a {...props} href={href} target="_blank" rel="noopener noreferrer"
        onClick={open} onAuxClick={(event) => { if (event.button === 1) open(event); }}
        aria-describedby={error ? errorId : props["aria-describedby"]}>
        {children}
      </a>
      {error && <span className="external-link-error" id={errorId} role="alert">Could not open your browser. Try again, or copy the link to open it manually.</span>}
    </>
  );
}
