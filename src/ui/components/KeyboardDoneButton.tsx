// Mobile-only "done typing" button, shown in a dialog's header.
//
// The on-screen keyboard covers the bottom of a dialog, and keeping a footer
// reliably above it does not work across Obsidian's iOS and Android webviews —
// the visualViewport measurement is not always trustworthy. A floating button
// pinned near the keyboard has the same problem, so this lives in the header
// instead: the mobile dialogs are top-anchored, which is the one part of the
// screen the keyboard can never cover.
//
// Tapping it blurs the field, the keyboard retracts, and the dialog's real
// actions (Save / Cancel) come back into view.

import { useEffect, useState, type RefObject } from "react";
import { Platform } from "obsidian";
import { ChevronUp } from "lucide-react";
import { t } from "src/i18n";

/** True for the fields whose focus raises the on-screen keyboard. */
function isTextField(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = (node as HTMLInputElement).type;
  return !["button", "submit", "reset", "checkbox", "radio", "file", "range", "color"].includes(type);
}

/**
 * @param containerRef Element whose focused fields this button reacts to —
 * usually the dialog overlay, not the header it renders into.
 */
export function KeyboardDoneButton({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!Platform.isMobile) return;
    const root = containerRef.current;
    if (!root) return;
    const doc = root.ownerDocument;
    const win = doc.defaultView ?? window;

    // focusin/focusout land before activeElement settles, so re-read it a tick
    // later — otherwise moving between two fields flickers the button.
    let timer = 0;
    const update = () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        const active = doc.activeElement;
        setVisible(isTextField(active) && root.contains(active));
      }, 0);
    };

    update();
    doc.addEventListener("focusin", update);
    doc.addEventListener("focusout", update);
    return () => {
      win.clearTimeout(timer);
      doc.removeEventListener("focusin", update);
      doc.removeEventListener("focusout", update);
    };
  }, [containerRef]);

  if (!Platform.isMobile || !visible) return null;

  return (
    <button
      type="button"
      className="dashboard-hub-keyboard-done"
      // preventDefault on pointerdown: a plain click would blur the field
      // first, the layout would reflow as the keyboard retracts, and the
      // click would land on whatever moved under the finger.
      onPointerDown={(event) => {
        event.preventDefault();
        const active = event.currentTarget.ownerDocument.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }}
    >
      <ChevronUp size={15} /> {t("common.doneInput")}
    </button>
  );
}
