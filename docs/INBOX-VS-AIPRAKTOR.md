# Inbox vs AiPraktor: the match check (14 Oct 2026, updated 15 Oct)

The owner asked for the Inbox to be built "as AiPraktor has built" it, with both WhatsApp routes kept. I built it,
then read their help centre again (121 answers, translated to English in `private/aipraktor/en/help-en.md`) and
checked each point against what is in our code. This is the result. Status words:

- **Same**: works the way their help centre describes.
- **Better**: we do more, or we do it where they say they cannot.
- **Missing**: they have it and we do not yet.
- **N/A**: does not apply to us.

Everything below runs on the **dev ERP only**. It is not on the live ERP.

## How the agent talks
| Point | Status | Note |
|---|---|---|
| Waits about 15 s so two quick messages get one reply (3 s on the website chat) | Same | `reply_due_at` debounce |
| Shows "Seen", then "typing…" | Same | Messenger; on WhatsApp, Evolution's presence |
| Speaks as "we"; never denies being an AI | Same | platform rules in the system text |
| স্যার/ম্যাম or ভাইয়া/আপু, with or without the first name | Same | Agent Desk |
| Keeps the customer's language; Banglish is answered in Bangla | Same | |
| Never invents a price, discount, stock or date; no haggling; offers only from the list | Same | |
| A missing fact is not a hand-over | Same | |
| Fixed hand-over reasons | Same | |
| Says "in stock / out of stock", never the count | Same | |
| Photo → product: printed code, then compared with our pictures, then the 10 closest | Same | `photoMatch`. The result is kept on the message so it is worked out once |
| Voice notes turned into text | Same | |

## Orders from the chat
| Point | Status | Note |
|---|---|---|
| Name, phone and address in one message → COD order, Pending | Same | |
| Card, receipt, thank-you with number, 1-5 stars (Messenger) | Same | Rating on Messenger only, as theirs |
| Bill as a picture; link to the order's own page | Same | The bill is drawn as a PNG (Bangla font included); order.html shows the status in the customer's words |
| Customer changes or cancels until approved; after that, a hand-over | Same | |
| Delivery charge inside/outside Dhaka; the AI's figure kept, difference noted | Same | |
| Hold with reason and follow-up day; "to follow up today" | Same | |
| Search orders, edit, team note, CSV (owner only) | Same | Added today |
| Same phone with another open order is flagged | Same | |
| Approve → the order **becomes a real ERP invoice** (stock, dues, courier, returns) | **Better** | Theirs is a separate order book you export |
| Stages, picking list, scan, courier, handover sheet, payment collected | **Better** | The ERP already has all of these |
| Customer told: being prepared, with the courier, delivered | Same | Inside Meta's 24 hours |
| Track button; Meta templates after 24 hours | Same | The Track button opens Steadfast's own tracking page. Templates: Create / Check on the channel card. They need the Meta app to work for real |
| "To chase": interested, no order since | Same | Leads tab |

## Bookings (service businesses), built today
| Point | Status | Note |
|---|---|---|
| Choose products, services or both | Same | Agent Desk → "This business" |
| Receptionist: answers from what is written, asks your questions one at a time | Same | |
| Never promises a result; never diagnoses | Same | |
| Records a request; the team confirms with one tap, proposes a time or declines | Same | Bookings tab |
| Optional automatic confirmation | Same | |
| Customer told in the chat: service, time, place, what to bring | Same | |
| Not told on the website chat | Same | They do not tell there either |
| Advance TrxID kept with the booking; the AI says "being checked"; a task for the team | Same | One TrxID can be used on only one booking |
| "Payment received" tells the customer | Same | |
| Reminders the day before and a few hours before (each can be switched off) | Same | |
| Reminder or confirmation after 24 hours as a Meta template ("Create / check") | Same | Sent once Meta approves the templates; until then the screen says the customer was not told |
| "Services" hides the shop's screens | N/A | Ours is a full ERP. Nothing is hidden |
| No calendar, no free-slot check | Same | They have none either |

## Team, hand-over, inbox
| Point | Status | Note |
|---|---|---|
| Take over for 30 min, 1 h, 6 h or for good; "." from the page or phone | Same | |
| Back to the AI by itself when the time ends; "never answered" | Same | |
| Every task stays open until a person acts | Same | Also when the AI is off on a live channel (theirs opens no task then) |
| Open / Later / Done | Same | |
| Off duty, with a sound | Same | Per device. The switch is at the top of the Inbox |
| Groups choose which hand-over reaches whom; a teammate limited to some pages | Same | Inbox → Team |
| Older messages | **Better** | They have no button. Ours has "Load older messages" |
| Download a conversation | **Better** | They cannot. Ours: ⤓ in the chat header |
| Pause the AI for the whole business | **Better** | They have no button. Ours is on Channels |
| AI off for one channel, for a time | Same | |
| Leads: AI-made, pipeline, Today, search, assign, CSV, WhatsApp button | Same | |
| Analytics 7/14/30 days | Same | |
| Saved replies, "suggest" and "adapt with AI" | Same | |
| Microphone dictation in the reply box | Same | 🎤 beside the photo button (Chrome, Edge); Bangla, or English when the customer writes English |
| Chrome extension | N/A | Skipped. The ERP is open in the browser anyway |
| Installs as a phone app | Same | The ERP page installs |

## Channels
| Point | Status | Note |
|---|---|---|
| Messenger, Instagram, page comments (reply by name, private message, hide/delete/block) | Same | Needs the owner's Meta app and App Review |
| WhatsApp, linked device (their way, WaSenderAPI) | Same | WaSenderAPI **and** Evolution. The owner must tick a risk notice |
| WhatsApp official Cloud API | **Better** | They do not offer it |
| Website chat: name + mobile, colour, photos, voice notes, voice call, daily limit | Same | |
| Practice mode, "test <code>", Go live after three test questions | Same | |
| Knowledge base: text, Q&A, .txt/.md/.csv, test box | Same | |
| Follow-ups cold/warm/hot inside 24 h | Same | |
| Broadcasts: last 23 h only, test first, gap since the last one (selectable) | Same | |
| Product page with a Buy button | Same | item.html, opened from a card's Details button. Buy keeps the interest for "To chase" and places an order linked to the chat |

## Money and data
| Point | Status | Note |
|---|---|---|
| Every AI call listed with its cost | Same | AI cost tab (estimated taka) |
| Prepaid credit | N/A | We use our own Gemini key |
| Keys never sent back to the browser | Same | Stored as server secrets |
| CSV exports: orders, leads, AI work, hand-overs | Same | |

## What still needs the owner
1. **A Gemini key on dev.** Without it the AI cannot answer on dev; everything else works.
2. **A Meta app and App Review** for Messenger, Instagram and the official WhatsApp.
3. **For the linked WhatsApp**, one of these:
   - an Evolution server (free software on a server), or
   - a WaSenderAPI subscription (paid).
4. **His yes** before any of this goes to the live ERP.

## Added 15 Oct: the Inbox as a subscription product
| Point | Status | Note |
|---|---|---|
| Every feature can be switched on or off | **Better** | 26 features in Inbox → Features. The provider's plan says which ones a company may use; the company's owner switches them on or off. Handlers, the AI's tools and the channels all follow it |
| AI credit, and the AI stops when it runs out | Same | A monthly AI budget in taka per plan, with a warning level. When it runs out the AI stops but messages are still kept. The team still gets an alert, which AiPraktor does not send |
| "Connect with Facebook" (no keys pasted) | Same | One login gives the pages, Instagram, WhatsApp numbers and ad accounts. The same login will serve posting and ads later |

Nothing in AiPraktor's help centre is left in the Missing column. What remains needs things outside the code:
1. The provider's Meta app, plus Meta's approval where it applies.
2. A real test on a live page.
