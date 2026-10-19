# Meta App Review: Costareen ERP (app 2156436555228139)

Prepared 19 Oct 2026. Submit only **after business verification is approved** (Security Centre shows
"Verified"). Meta now reviews the whole app on every submission and a submission cannot be edited or
cancelled once sent, so check everything below first.

## 0. What is being asked for

The App Review page currently lists 7 requests:

| Request | Needed? | Why |
|---|---|---|
| pages_messaging | **Yes** | Receive and answer Messenger messages in the ERP Inbox |
| pages_manage_metadata | **Yes** | Subscribe the page to the app's webhook so messages reach the ERP |
| pages_show_list | **Yes** | Show the pages the owner manages so they pick which one goes into the Inbox |
| Business Asset User Profile Access | **Yes** | Show the customer's name and picture beside their chat |
| Human Agent | **Yes** | A staff member can still answer a customer up to 7 days after their last message |
| public_profile | Yes (automatic) | Name of the person who logged in, shown as "Logged in as …" |
| business_management | **Recommend removing** | Only used to list WhatsApp numbers and ad accounts, which are not in use yet. Asking for it without showing it in use is a common reason for rejection. Add it later when WhatsApp or ads are switched on. |

To remove business_management: App dashboard → Use cases → the use case that holds it → Customize →
remove. (If Meta does not let it be removed from Facebook Login for Business, keep it and use the
text in section 1.7.)

## 1. Text to paste for each request

Meta asks two things per request: how the app uses it, and step-by-step instructions for the reviewer.
The same screencast (section 2) is uploaded for every request.

### 1.1 pages_messaging

**How will your app use this permission?**
Costareen is a 3D printer and filament shop in Dhaka, Bangladesh. Costareen ERP is the shop's own
business system (stock, invoices, customers). Its Inbox screen shows the Messenger conversations of
our Facebook Page "Costareen 3D" so our staff can answer customers in the same place where they check
stock and make invoices. When a customer messages the Page, the message appears in the ERP Inbox. Our
staff, or our shop assistant that only answers product, price, stock-availability and delivery
questions from our own catalogue, replies from the Inbox and the reply is sent to the customer through
the Send API. We only reply to people who message us first, inside the standard messaging window, and
we never send promotional messages outside it.

**Steps for the reviewer**
1. Watch the screencast: the owner logs in with Facebook in Settings → Connections and chooses the Page.
2. A test user sends "Do you have black PLA?" to the Page on Messenger.
3. The message appears in the ERP Inbox within seconds.
4. The reply (product, price, availability) is sent and appears in the customer's Messenger.
5. A staff member types a reply in the Inbox and presses Send; it arrives in Messenger.

### 1.2 pages_manage_metadata

**How will your app use this permission?**
When the owner chooses a Page in Settings → Connections and presses "Use for Messenger", the ERP
subscribes that Page to our app's webhook (POST /{page-id}/subscribed_apps with messages,
messaging_postbacks and message_echoes). Without this, new customer messages and replies typed by our
staff in the Page inbox would not reach the ERP Inbox. We do not change any other Page settings.

**Steps for the reviewer**
1. In the screencast, Settings → Connections → Facebook shows the Pages from the login.
2. The owner presses "Use for Messenger" on the Page; it changes to "IN THE INBOX".
3. A message sent to the Page now appears in the ERP Inbox, showing the subscription works.

### 1.3 pages_show_list

**How will your app use this permission?**
After the owner logs in with Facebook, the ERP lists the Pages they manage (name only) in Settings →
Connections, so the owner can choose which Page is connected to the Inbox. The list is shown only to
the owner of the business in the ERP.

**Steps for the reviewer**
1. In the screencast, the owner opens Settings → Connections and presses "Connect with Facebook".
2. After login, the box shows "Logged in as …" and the list of their Pages.
3. The owner chooses one Page with "Use for Messenger".

### 1.4 Business Asset User Profile Access

**How will your app use this feature?**
When a customer messages our Page, the ERP Inbox shows the customer's name and profile picture beside
the conversation so staff know who they are talking to and can address them by name. We read only the
name and picture of people who have messaged our Page, keep them with that conversation only, and do
not share them with anyone. A customer can ask for deletion as described at
https://erp.costareen.com/data-deletion.

**Steps for the reviewer**
1. In the screencast, the test user messages the Page.
2. The ERP Inbox list and the chat header show that person's name and picture.

### 1.5 Human Agent

**How will your app use this feature?**
Customers often ask about an order or a product that has to be checked in the warehouse, and the
answer can take more than 24 hours. When a staff member replies to such a customer more than 24 hours
after the customer's last message (and within 7 days), the ERP sends that reply with the HUMAN_AGENT
tag. It is used only for a person's own reply typed in the Inbox, never for automated or promotional
messages.

**Steps for the reviewer**
1. In the screencast, a staff member opens a conversation whose last customer message is more than
   24 hours old.
2. The staff member types the answer and presses Send; it arrives in Messenger.

### 1.6 public_profile

**How will your app use this permission?**
After the owner logs in with Facebook in Settings → Connections, the ERP shows "Logged in as <name>"
so the owner knows which Facebook account is connected.

### 1.7 business_management (only if it cannot be removed)

**How will your app use this permission?**
After the owner logs in with Facebook, the ERP reads the business portfolio "Costareen" that owns our
Page, to list the Page and our business's WhatsApp numbers in Settings → Connections so the owner can
choose which ones go into the Inbox. We only read; we do not create or change anything in the
business portfolio.

## 2. The screencast (one video, about 3 minutes, used for every request)

Meta rejects videos it cannot follow. Rules:
- ERP in **English** (language switch on), browser zoom 100%, 1280x720 or larger, no music.
- Show the **whole Facebook login dialog**, including the screen listing the permissions.
- Use a **test chat**, not a real customer, and no real customer names, phones or prices on screen.
  Use the old account (Abidur Rahman Nazir) as the test customer.
- Add short captions if possible (Clipchamp, built into Windows, can add text).

**How to record on Windows:** press **Win + Shift + R** (Snipping Tool screen recording), drag around
the browser window, press Start. Save as MP4.

Before recording, make the AI answer the test chat: the page is still in practice mode, so the test
chat must start with "test 16716" (send it before recording, so it is not in the video).

**Scene list**
1. *(0:00)* Open https://erp.costareen.com (signed in as owner), show the dashboard for 2 seconds.
2. *(0:10)* Settings → **Connections** → Facebook box. Press **Log in again**.
3. *(0:20)* Facebook dialog: continue as Rahman Nazir, tick the **Costareen 3D** page, show the
   permission list screen, press **Save/Done**. (Slow down here; this is what reviewers look for.)
4. *(0:50)* Back in the ERP: "Logged in as Rahman Nazir", the page list (pages_show_list). Point at
   **IN THE INBOX** on Costareen 3D (pages_manage_metadata). If it shows "Use for Messenger", press it.
5. *(1:05)* Switch to the old account's Messenger (second Chrome), chat with Costareen 3D, send
   **"Do you have black PLA?"**.
6. *(1:20)* Back in the ERP → **Inbox**: the message appears with the customer's name and picture
   (Business Asset User Profile Access). Wait for the reply; show it in the ERP and in Messenger
   (pages_messaging).
7. *(1:50)* In the ERP Inbox, type a reply as staff: **"Our team will deliver it tomorrow."**, press
   Send. Show it arriving in Messenger.
8. *(2:10)* Human Agent: open a test chat whose last customer message is older than 24 hours
   (the old "Abidur Nazir" chat from 18 Oct qualifies after 19 Oct 19:20 UTC). Type a reply and send;
   show it arriving.
9. *(2:30)* Open https://erp.costareen.com/privacy and /data-deletion for 3 seconds each. End.

## 3. Reviewer access

The ERP is our own internal business system with no public sign-up, and it holds real customer and
financial data, so we do not give reviewers a login to it. Write this in the "Notes for reviewer" box:

> Costareen ERP is the internal business system of one company, Costareen (Dhaka, Bangladesh), the
> owner of the Facebook Page "Costareen 3D". It has no public sign-up and contains real customer and
> financial data, so we cannot share a login. The attached screencast shows the full flow: Facebook
> Login, choosing the Page, receiving a Messenger message in our Inbox, replying, and a human agent
> reply after 24 hours. The app is used only by our own staff for our own Page.

If Meta insists on access, the fallback is a separate demo company on the same system with made-up
data (to be built; say so before submitting again).

## 4. Before pressing Submit

- [ ] Business verification shows **Verified** (Security Centre).
- [ ] App settings → Basic: icon, privacy URL https://erp.costareen.com/privacy, data deletion URL
      https://erp.costareen.com/data-deletion, category, contact email all filled (already are).
- [ ] Each permission shows a test API call in the last 30 days (Use cases → each permission). The
      Messenger test on 18-19 Oct counts; if any shows "0 calls", send one more test message first.
- [ ] business_management removed (or text 1.7 used).
- [ ] The screencast is uploaded on every request, and the text from section 1 pasted.
- [ ] Facebook Business Suite **Auto-reply** and **Leads** automations are off.
