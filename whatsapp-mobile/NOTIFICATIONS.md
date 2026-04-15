## Push notifications (Expo)

This app uses **Expo Push Notifications** via `expo-notifications`.

### What must be configured

- **EAS project id**: `app.json` → `expo.extra.eas.projectId` (already present). The client uses this to request an Expo push token.
- **Expo push credentials**:
  - **Android (FCM)** and **iOS (APNs)** credentials are managed in your Expo/EAS project.
  - If you decide to add native Firebase config files later, keep them out of git:
    - `google-services.json`
    - `GoogleService-Info.plist`

### Runtime flow

- On first authenticated launch, the client:
  - requests permission
  - creates an Expo push token
  - POSTs it to the backend at `POST /api/push/register`
- The backend sends notifications when a new inbound WhatsApp message is received by the webhook.

