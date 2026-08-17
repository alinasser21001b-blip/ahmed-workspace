import { Platform } from 'react-native';

/**
 * The desktop canvas.
 *
 * The approved design is a phone composition — every frozen frame is drawn at
 * 390 px and nothing wider was ever reviewed. Rendered edge to edge in a
 * desktop browser that composition is destroyed: rows stretch to 1400 px, the
 * masthead floats in a corner, the reading measure triples, and the tab bar
 * becomes a full-width strip. The stretched page is not a bigger Student OS;
 * it is a different, unapproved one.
 *
 * So on viewports from 520 px up, the app renders inside a bounded, centred
 * canvas at 430 px — phone width, the top of the range the frames were drawn
 * for — on the same neutral ground the reference page draws its phones on
 * (#EDEEF1). This is deliberately NOT a desktop product design: it is the
 * approved mobile composition presented honestly, until a desktop pass is
 * actually designed and reviewed. Below 520 px nothing changes, which
 * preserves the verified 360/390 behaviour.
 *
 * Why a stylesheet on `#root` rather than a wrapper view: the app positions
 * absolute-fill surfaces (modals, Practice) against the root element, so
 * constraining the root keeps every such surface inside the canvas for free.
 * Why runtime injection rather than `+html.tsx`: this project exports with
 * `web.output: "single"`, and Expo only consults `+html.tsx` for static
 * output. Injection at module scope runs before the app's first paint, which
 * is itself held until the fonts resolve — so no stretched frame is ever
 * shown.
 *
 * The colour literals are the frozen tokens (`paper50`, `paper200`) plus the
 * reference page's own canvas ground; they are literals here because this
 * file runs before any theme exists.
 */
export function installWebCanvas(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('sos-web-canvas')) return;

  const style = document.createElement('style');
  style.id = 'sos-web-canvas';
  style.textContent = `
    body { background: #FCFBF9; }
    @media (min-width: 520px) {
      body { background: #EDEEF1; }
      #root {
        max-width: 430px;
        margin: 0 auto;
        border-left: 1px solid #DEE2E9;
        border-right: 1px solid #DEE2E9;
        box-shadow: 0 10px 34px rgba(11, 16, 32, 0.10);
        background: #FCFBF9;
        position: relative;
        overflow: hidden;
      }
    }
  `;
  document.head.appendChild(style);
}
