# TableTicket — Restaurant Billing & CRM

A complete, sellable POS for restaurants/cafés: table-wise ordering with size/variant/add-on picking, GST billing formatted for an 80mm thermal printer, WhatsApp bill sending, and a lightweight CRM — all on Firebase, one restaurant per login (multi-tenant, ready to resell to many clients).

## Files
- `index.html` — app shell
- `style.css` — design system
- `app.js` — all logic (Firebase Auth + Firestore)

Open `index.html` on any static host (Firebase Hosting, Netlify, or even just double-click it locally — Firebase works over CDN).

## 1. Firestore security rules (REQUIRED)
Right now your Firestore is in default locked mode, so nothing will save until you set rules. Go to **Firebase Console → Firestore Database → Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /restaurants/{restoId} {
      allow read, write: if request.auth != null && request.auth.uid == restoId;
      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == restoId;
      }
    }
  }
}
```
This keeps every restaurant's data completely isolated — each signup creates one Firebase Auth user whose UID becomes the restaurant's document ID, so a café can never see another café's tables, menu, or bills.

## 2. Enable Email/Password auth
**Firebase Console → Authentication → Sign-in method → Email/Password → Enable.**

## 3. How the data model works (for when you extend it)
- `restaurants/{uid}` — profile: name, address, GSTIN, phone, CGST%/SGST%, bill footer
- `restaurants/{uid}/tables/{id}` — table name, status (free/occupied), running total
- `restaurants/{uid}/menu/{id}` — item with `variants: [{name, price}]` (sizes) and `addons: [{name, price}]` (toppings/sauces)
- `restaurants/{uid}/orders/{id}` — table-wise cart, status open/billed (this is your KOT)
- `restaurants/{uid}/bills/{id}` — finalized GST bill, sequential `billNo`
- `restaurants/{uid}/customers/{phone}` — auto-created CRM record (name, total orders, total spend, last visit)
- `restaurants/{uid}/meta/counters` — sequential bill numbering per restaurant

## 4. WhatsApp sending — important limitation
The "Send on WhatsApp" button opens `wa.me` with the full itemized bill pre-typed into WhatsApp — the owner/staff taps send once. This works instantly, for free, with zero setup, and is what almost every small-restaurant billing tool actually ships with.

**True automatic sending "from your software's name"** (no tap needed, custom sender name/number) requires the **WhatsApp Business Platform API** through a Meta Business Partner (Interakt, AiSensy, Gupshup, Wati, etc.) — that's a paid, approval-gated integration with its own per-message cost. If you want that for a premium tier, the plug-in point is the `waBillBtn` handler in `app.js` — swap the `wa.me` link for a `fetch()` call to your chosen provider's send-message API.

## 5. Selling this to multiple restaurants
Because auth UID = restaurant ID, this is already multi-tenant: every new café just signs up and gets their own isolated tables/menu/bills/customers, no code changes needed per client. Ideas for packaging it as a product:
- Give each client their own subdomain or a shared login page with your branding
- Add a "Pro" tier gate (e.g. a `plan` field on the restaurant doc) once you're ready to charge for extras like the WhatsApp Business API or multi-staff logins
- Multi-staff logins (waiter vs owner roles) and printer auto-detect are the two most-requested next features — both are straightforward additions to this structure

## 6. Using it day to day
1. Settings → fill in restaurant name, address, GSTIN, phone, CGST/SGST %, footer note
2. Menu Builder → add items; for pizza-style items add Size variants (Small/Medium/Large) and Add-ons (Extra Cheese, Jalapeno, etc.) — leave variants empty and just set a base price for simple items like a Coke
3. Tables → add your tables/sections
4. Tap a table → pick items (choose size + add-ons per item) → "Save order (KOT)" sends it to the kitchen without billing, or "Generate GST bill" closes the table and prints/WhatsApps the bill
5. Bill History and Customers build automatically from there
