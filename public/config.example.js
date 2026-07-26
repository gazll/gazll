/* Backend config template. Copy to config.js for local dev (gitignored);
   on Pages it is generated from repo variables by deploy.yml.

   Neither value is a secret — the browser needs both, so they are readable
   in the page source no matter where they are stored. Access control lives
   in apps-script/Code.gs (ID token check + ALLOWED_EMAILS), not here.

   Empty -> offline mode: everything works, stored in localStorage only. */

/** Google Cloud Console -> Credentials -> OAuth client ID (Web application). */
export const GOOGLE_CLIENT_ID = '';

/** Apps Script -> Deploy -> Web app -> URL ending in /exec. */
export const SCRIPT_URL = '';
