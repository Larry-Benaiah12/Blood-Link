// App settings you fill in once.

// Google sign-in for donors.
// 1. Go to https://console.cloud.google.com/apis/credentials
// 2. Create credentials → OAuth client ID → "Web application".
// 3. Under "Authorized JavaScript origins" add every address the site runs on,
//    e.g. http://localhost:5500, http://127.0.0.1:5500 and your https:// domain.
// 4. Paste the client ID below (it looks like 1234-abc.apps.googleusercontent.com).
//
// While this is empty, the "Continue with Google" button runs in demo mode
// (you type a Gmail address) so the rest of the flow can still be tested.
export const GOOGLE_CLIENT_ID = "";
