## Push notifications (Expo) — full setup checklist

Notifications require **three layers** to align. If any layer is wrong, the app may get a push token but **no notification will ever arrive**.

### Layer 1 — Firebase Android app (`google-services.json`)

The file in this repo must come from the **same Firebase project** as your FCM v1 service account on EAS.

Current expected project: **`vacationsaga-429508`** (see `firebase.config.json`).

1. Open [Firebase Console → vacationsaga-429508](https://console.firebase.google.com/project/vacationsaga-429508/settings/general)
2. **Add app** → Android → package name: `com.zaidzz4.whatsappmobile`
3. Download `google-services.json` → save as `whatsapp-mobile/google-services.json`
4. Rebuild native app:
   ```bash
   npm run setup:push
   npx expo prebuild --platform android --clean
   npm run android
   ```
   (Or install a new EAS build on the physical device.)

Validate locally:
```bash
npm run setup:push
```
This fails if `google-services.json` project_id ≠ `vacationsaga-429508`.

### Layer 2 — EAS FCM v1 credentials (server → device delivery)

Expo's push service uses your FCM v1 **service account JSON** to deliver to Android.

1. In Firebase Console → Project settings → **Service accounts** → Generate new private key
2. Upload to EAS:
   ```bash
   eas credentials
   ```
   Android → production → **Google Service Account** → **FCM v1** → upload JSON
3. The service account `project_id` must match `google-services.json` `project_info.project_id`.

**Never commit** the service account JSON (use `*-firebase-adminsdk-*.json` / `vacationsaga-*.json` in `.gitignore`).

### Layer 3 — Backend token registration + send

**Mobile app (on login):**
- Requests notification permission
- Obtains Expo push token (`getExpoPushTokenAsync`)
- `POST /api/push/register` with Bearer JWT

**Backend (on inbound WhatsApp message):**
- Webhook finds eligible employees → `sendExpoPushToEmployee`
- Uses channel `whatsapp-messages` (must match `ChannelManager.ts`)

**Test from API (after login on mobile):**
```bash
curl -X POST https://adminstro.in/api/push/test \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "x-device-type: mobile"
```

- `NO_DEVICE_TOKENS` → app never registered token (re-login, check permission, rebuild with correct `google-services.json`)
- `success: true` but no banner → Firebase/EAS project mismatch or OEM battery restrictions

### Common failure modes

| Symptom | Cause |
|--------|--------|
| "FirebaseApp is not initialized" | Missing/wrong `google-services.json` in native build |
| Token registers, zero notifications | `google-services.json` project ≠ EAS FCM project |
| Test API: NO_DEVICE_TOKENS | Token not saved — auth error or app on emulator (`Device.isDevice` false) |
| Notifications on web only | Mobile token not in DB; check `/push/register` |
| No push when chat open | By design — unread filter + same-conversation suppression |

### EAS project id

`app.json` → `expo.extra.eas.projectId` — required for `getExpoPushTokenAsync`.
