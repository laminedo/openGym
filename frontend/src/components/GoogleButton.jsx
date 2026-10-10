import { t } from '../lib/i18n.js'
import { googleStartUrl } from '../lib/google.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

// Google's "G" in its four colours. Their branding guidelines ask a sign-in button to carry it
// as it is — never tinted with the app's accent — next to the words "Continue with Google".
const G = <svg className="g-logo" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
</svg>

/* "Continue with Google". A page load, not a fetch: the browser goes to the server, which sends
   it on to Google and gets it back (lib/google.js). On an invite-only instance the sign-up sheet
   passes the code it collected; `needInvite` refuses to leave without one.

   A sign-out the server never heard of is finished first: boot finishes it before anything else
   (useStore), and finished then, its answer would expire the session Google just opened. */
export default function GoogleButton({ invite = '', needInvite = false }) {
  const go = async () => {
    if (needInvite && !String(invite).trim()) { useUI.getState().toast(t('An invite code is required')); return }
    if (!(await useStore.getState().finishOwedLogout())) { useUI.getState().toast(t('Offline. The server can’t be reached')); return }
    window.location.assign(googleStartUrl(invite))
  }
  return <button type="button" className="btn google" onClick={go}>{G}<span>{t('Continue with Google')}</span></button>
}
