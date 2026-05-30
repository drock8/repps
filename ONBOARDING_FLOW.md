# Onboarding Flow — Guest-First Experience

> Canonical spec for the new onboarding/auth flow. Replaces the current "sign in before you DAB" gate.

## Core Principle

**Let users experience verified burpees first, convert them after.**

Anonymous reps still count toward the global 1M target. Signup is the gate for claiming a leaderboard spot, profile, and (later) teams.

---

## Flow Diagram

```
HOME (everyone sees "DAB NOW")
  │
  ▼
DAB FLOW (no auth required)
  ├─ Camera + pose detection
  ├─ Reps counted in real-time
  ├─ Each rep inserted to DB with user_id = NULL (anonymous)
  └─ Video recorded as normal
  │
  ▼
SUMMARY SCREEN
  ├─ Video playback + rep count + global total
  ├─ Action bar: Home | Share | Save
  │
  ▼ (after Share or Save action)
GENDER PICKER (inline, not a modal)
  ├─ "See how you rank!"
  ├─ Three buttons: Female | Male | Non-binary
  ├─ Choice stored in localStorage (guest) or profile (signed-in)
  │
  ▼
LEADERBOARD (auto-navigated)
  ├─ Pre-filtered: selected gender + Daily
  ├─ Guest's session reps shown highlighted (burnt orange glow)
  ├─ Top entries visible behind/around the signup prompt
  │
  ▼
SIGNUP OVERLAY (bottom sheet)
  ├─ "Lock in your verified reps — sign up!"
  ├─ [Continue with Google] button
  ├─ [Sign up with Email] button
  ├─ [Maybe later] dismiss link
  │
  ├─► ON SIGNUP:
  │     ├─ Create profile (name from Google or email)
  │     ├─ Attach anonymous session reps to new user_id
  │     ├─ Set gender from earlier picker
  │     ├─ Clear guest localStorage
  │     └─ Leaderboard refreshes showing their claimed spot
  │
  └─► ON DISMISS:
        ├─ Overlay closes
        ├─ User can browse app freely (leaderboard, home)
        ├─ DAB NOW still available (more anonymous reps)
        └─ Profile tab shows sign-in prompt
```

---

## What Changes Per Screen

### HOME (`/`)

| Before | After |
|--------|-------|
| Signed-in users see "DAB NOW" | Everyone sees "DAB NOW" |
| Guests see "LFG!" (triggers Google sign-in) | "LFG!" removed |
| "Already have account? Sign in" link | Move sign-in option to Profile tab |

### DAB (`/dab`)

| Before | After |
|--------|-------|
| Redirects to `/` if not authenticated | No auth check — anyone can DAB |
| `insertRep(userId)` requires user ID | Guest: insert with `user_id = NULL`, track session rep IDs in localStorage |
| QR code uses `profile.id` | Guest: QR links to app URL (no user ID) |
| Brand overlay reads profile | Guest: works without profile (fallback name) |

### SUMMARY (within `/dab`)

| Before | After |
|--------|-------|
| Shows "YOUR TOTAL" (lifetime) | Guest: show only session reps + global total (no "YOUR TOTAL") |
| Action bar: Home \| Share \| Save | Same, but after Share/Save → gender picker → leaderboard |

### LEADERBOARD (`/leaderboard`)

| Before | After |
|--------|-------|
| Standard leaderboard with filters | Add: guest highlight row, signup overlay |
| Gender/time filters user-controlled | Auto-set to guest's gender + Daily when arriving from DAB flow |

### PROFILE (`/profile`)

| Before | After |
|--------|-------|
| Shows profile or sign-in CTA | Guest: show sign-in CTA with Google + Email options |

---

## Guest Session Data (localStorage)

Key: `repps_guest_session`

```json
{
  "repIds": ["uuid-1", "uuid-2", "uuid-3"],
  "repCount": 3,
  "gender": "female",
  "timestamp": "2026-05-29T10:30:00Z"
}
```

- `repIds` — UUIDs of anonymous reps inserted to DB (needed to attach to user on signup)
- `gender` — selected on the gender picker screen
- Cleared after successful signup and rep attachment

---

## Database Changes

### `reps` table

- `user_id`: change from `NOT NULL` to `NULLABLE`
- Anonymous reps have `user_id = NULL`
- On signup, `UPDATE reps SET user_id = <new_user_id> WHERE id IN (<repIds from localStorage>)`

### RLS policy updates

- Allow anonymous inserts (no auth required for insert)
- Keep authenticated insert policy for signed-in users
- Read policy unchanged (public)

### Auth configuration

- Enable **Email** provider in Supabase Auth settings (Dashboard > Authentication > Providers)
- Google OAuth remains as-is

---

## Signup Methods

### Google OAuth (existing)
- `supabase.auth.signInWithOAuth({ provider: 'google' })`
- Profile auto-created from Google metadata (name, avatar)

### Email/Password (new)
- **Sign up**: `supabase.auth.signUp({ email, password })`
- **Sign in**: `supabase.auth.signInWithPassword({ email, password })`
- Profile auto-created with email username as display name
- No email confirmation required for v0.1 (set in Supabase dashboard: Auth > Settings > disable "Enable email confirmations")

---

## Post-Signup: Attach Anonymous Reps

After successful authentication (either method):

1. Read `repps_guest_session` from localStorage
2. If `repIds` exist:
   - `UPDATE reps SET user_id = <user.id> WHERE id = ANY(<repIds>)`
   - Update profile gender if not already set: `UPDATE profiles SET gender = <guest_gender>, gender_set = true`
3. Clear `repps_guest_session` from localStorage
4. Refresh leaderboard

---

## Leaderboard Signup Overlay

### Trigger
- Appears when navigating to `/leaderboard` with query params `?signup=1&gender=<g>&reps=<n>`
- Only shows for unauthenticated users
- Does NOT show on normal leaderboard visits (e.g., from bottom nav while browsing)

### Design
- Bottom sheet, slides up from bottom
- Semi-transparent backdrop (tap to dismiss)
- Content:
  - Rep count badge: "+3 VERIFIED REPS"
  - Headline: "Lock in your spot"
  - Subtext: "Sign up to claim your reps on the leaderboard"
  - [Continue with Google] — full-width button, Google icon
  - [Sign up with Email] — full-width button, mail icon
  - "Maybe later" — text link, dismisses overlay

### Guest Highlight Row
- Shown in the leaderboard list at the position their rep count would place them
- Styled differently: burnt orange left border or glow, "You" label, lock icon
- Disappears after dismiss (reps still in DB as anonymous, just not highlighted)

---

## Teams (Post-Signup, Future Phase)

Teams are surfaced AFTER a user has signed up. Not part of the guest flow.

- After first signup → optional "Find 2, build a team" prompt
- Invite codes for viral team building
- Teams leaderboard tab on leaderboard page: Individual | Teams
- Will be built as a separate phase after this onboarding flow is complete

---

## Build Order

| Step | What | Files |
|------|------|-------|
| 1 | DB migration: nullable user_id, RLS updates, email auth | SQL script (run manually) |
| 2 | Remove auth gate from DAB flow | `Dab.tsx` |
| 3 | Guest rep tracking (localStorage + null user_id inserts) | `Dab.tsx`, new `lib/guestSession.ts` |
| 4 | Summary → gender picker → leaderboard redirect | `Dab.tsx` |
| 5 | Home page: "DAB NOW" for everyone | `Home.tsx` |
| 6 | Leaderboard: guest highlight + signup overlay | `Leaderboard.tsx` |
| 7 | Email auth (signup + signin) | `AuthContext.tsx`, `Leaderboard.tsx` |
| 8 | Post-signup rep attachment | `AuthContext.tsx`, `lib/guestSession.ts` |
| 9 | Profile tab sign-in CTA for guests | `Profile.tsx` |
