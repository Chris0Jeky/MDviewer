/**
 * Sanitize markdown-rendered HTML before it reaches the live document.
 *
 * Markdown-it intentionally accepts raw HTML, and paste/file inputs may be untrusted.
 * DOMPurify removes executable markup and event handlers; the second pass enforces the
 * stricter local-first contract by stripping attributes that can fetch remote resources.
 * User-initiated links remain usable, but media can only use embedded raster data URLs.
 */

import DOMPurify from "dompurify";

export interface SanitizedHtml {
  html: string;
  removedCount: number;
}

const FORBID_TAGS = [
  "script",
  "style",
  "link",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "base",
  "meta",
  "form",
  "button",
  "textarea",
  "select",
  "option",
  "video",
  "audio",
  "source",
  "track",
] as const;

const FORBID_ATTR = ["srcdoc", "ping", "formaction", "action", "autofocus"] as const;
const AUTOLOAD_ATTRS = ["srcset", "poster", "background", "data"] as const;
const UNSAFE_CSS =
  /(?:url\s*\(|@import|expression\s*\(|(?:-webkit-)?image-set\s*\(|cross-fade\s*\(|element\s*\(|paint\s*\()/i;
const SAFE_EMBEDDED_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

function serialize(fragment: DocumentFragment): string {
  const template = document.createElement("template");
  template.content.append(fragment);
  return template.innerHTML;
}

/**
 * Return safe HTML plus the number of removed elements/attributes/resources.
 * The count is only used to tell the user that content was blocked; it is not a
 * security decision (the sanitized output itself is the security boundary).
 */
export function sanitizeRenderedHtml(html: string): SanitizedHtml {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: [...FORBID_TAGS],
    FORBID_ATTR: [...FORBID_ATTR],
  }) as DocumentFragment;

  let removedCount = DOMPurify.removed.length;

  for (const element of Array.from(fragment.querySelectorAll("*"))) {
    for (const attr of AUTOLOAD_ATTRS) {
      if (element.hasAttribute(attr)) {
        element.removeAttribute(attr);
        removedCount += 1;
      }
    }

    const style = element.getAttribute("style");
    if (style && UNSAFE_CSS.test(style)) {
      element.removeAttribute("style");
      removedCount += 1;
    }

    if (element.localName === "img") {
      const src = element.getAttribute("src");
      if (src && !SAFE_EMBEDDED_IMAGE.test(src.trim())) {
        element.removeAttribute("src");
        removedCount += 1;
      }
    } else if (element.hasAttribute("src")) {
      element.removeAttribute("src");
      removedCount += 1;
    }

    // Raw HTML may include inputs. Preserve markdown-it task-list checkboxes, but
    // force every surviving input into the same inert, disabled shape.
    if (element.localName === "input") {
      const keepChecked = element.hasAttribute("checked");
      for (const attr of Array.from(element.attributes)) element.removeAttribute(attr.name);
      element.setAttribute("type", "checkbox");
      element.setAttribute("disabled", "");
      element.setAttribute("class", "task-list-item-checkbox");
      if (keepChecked) element.setAttribute("checked", "");
    }

    // SVG <image>/<use> hrefs can load external resources. Fragment-only references
    // are safe for inline SVG; ordinary HTML anchors remain user-navigable.
    if (element.namespaceURI === "http://www.w3.org/2000/svg") {
      for (const attr of ["href", "xlink:href"] as const) {
        const value = element.getAttribute(attr);
        if (value && !value.startsWith("#")) {
          element.removeAttribute(attr);
          removedCount += 1;
        }
      }
    }

    if (element.localName === "a" && element.getAttribute("target") === "_blank") {
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  return { html: serialize(fragment), removedCount };
}
