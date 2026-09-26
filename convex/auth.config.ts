/**
 * Convex accepts Firebase ID tokens from Google Sign-In.
 * Project: cmiyc-d170c (OpenVerse production Firebase).
 */
const firebaseProjectId = "cmiyc-d170c";

export default {
  providers: [
    {
      domain: `https://securetoken.google.com/${firebaseProjectId}`,
      applicationID: firebaseProjectId,
    },
  ],
};
