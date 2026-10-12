/* The ERP's own help (FilaDash merge): step-by-step guides in Bangla and English, one per task, each tied to the screen
   it is about (view). Loaded on demand by the Help screen (block fd-15 in app.html). Button names are written as they
   appear on screen, in quotes. Numbers in the examples are made up. */
window.ERP_HELP = [
  { id: 'dash', view: 'dash',
    bn: { t: 'ড্যাশবোর্ড পড়া', s: [
      'উপরের বোতাম দিয়ে সময় বেছে নিন: "This month", "3 months", "6 months" বা "12 months"। প্রতিটা সংখ্যা আগের সমান সময়ের সাথে তুলনা করে (▲ বাড়লে, ▼ কমলে)।',
      'পাশের ড্রপডাউন থেকে "Filaments", "Printers" ইত্যাদি বাছলে শুধু সেই গ্রুপের বিক্রি, খরচ, গ্রস লাভ আর স্টক দেখাবে। নেট লাভ, খরচ, বাকি আর ক্যাশ পুরো ব্যবসার — তাই গ্রুপ বাছলে সেগুলো দেখায় না।',
      'বেগুনি বড় কার্ডটা নেট লাভ — Profitability স্ক্রিনের সাথে হুবহু এক।',
      'যেকোনো টাকার সংখ্যার পাশের ছোট "i" চাপলে দেখবেন সংখ্যাটা কীভাবে হিসাব হলো।',
      'নিচে Top Products, Recent Sales, Needs Attention আর Reorder Suggestions — যেকোনো সারিতে চাপলে সেই স্ক্রিন খুলবে।',
      'পুরনো ড্যাশবোর্ড লাগলে একদম নিচে "More: the classic dashboard"।'] },
    en: { t: 'Reading the dashboard', s: [
      'Pick the period at the top: "This month", "3 months", "6 months" or "12 months". Each figure is compared with the same length of time before (▲ up, ▼ down).',
      'The drop-down next to it ("Filaments", "Printers" ...) shows that group only: its sales, cost, gross profit and stock. Net profit, expenses, dues and cash belong to the whole business, so they are hidden for a group.',
      'The big purple card is net profit - exactly the Profitability screen\'s figure.',
      'Press the small "i" beside any money figure to see how it is worked out.',
      'Below: Top Products, Recent Sales, Needs Attention and Reorder Suggestions - press a row to open that screen.',
      'The old dashboard is at the very bottom: "More: the classic dashboard".'] } },

  { id: 'invoice', view: 'invoice',
    bn: { t: 'নতুন বিক্রি (ইনভয়েস)', s: [
      'বাম মেনু থেকে "New invoice"।',
      'কাস্টমারের ফোন নম্বর লিখুন (১১ অঙ্ক)। আগের কাস্টমার হলে নাম আর ঠিকানা নিজে থেকেই আসবে।',
      '"Add products"-এ পণ্যের নাম, SKU বা ব্র্যান্ড লিখে বেছে নিন, পরিমাণ দিন।',
      'ডেলিভারি বাছুন। কুরিয়ারে পাঠালে "Cash on delivery"ও বাছতে পারেন।',
      'টাকা কীভাবে পেলেন: "Paid now", "Part paid" বা "Due" — আর কোন মাধ্যমে (Cash, bKash ...)।',
      '"Save invoice" চাপুন। কাস্টমারের আগের অগ্রিম (যেমন প্রি-অর্ডারের টাকা) থাকলে তা নিজে থেকেই এই বিলে কাটা যাবে।',
      'কোনো পণ্য প্রি-অর্ডারের জন্য রাখা থাকলে ইআরপি থামাবে আর বলবে কার জন্য রাখা। শুধু মালিক কারণ লিখে তবু বিক্রি করতে পারেন।'] },
    en: { t: 'Making a sale (New invoice)', s: [
      'Open "New invoice" from the menu.',
      'Type the customer\'s phone (11 digits). A known customer\'s name and address fill in by themselves.',
      'In "Add products" type a name, SKU or brand, pick it and set the quantity.',
      'Choose the delivery. Sent by courier, you can choose "Cash on delivery".',
      'How it was paid: "Paid now", "Part paid" or "Due" - and by what (Cash, bKash ...).',
      'Press "Save invoice". Credit the customer already has (a pre-order deposit, for example) pays this invoice by itself.',
      'A unit held for someone\'s pre-order stops the sale and says for whom. Only the owner can sell it anyway, with a reason.'] } },

  { id: 'sales', view: 'sales',
    bn: { t: 'বিক্রি, বাকি আর রিটার্ন', s: [
      '"Sales" স্ক্রিনে সব ইনভয়েস। উপরের কার্ডে এ মাসের বিক্রি, অর্ডার, বাকি টাকা।',
      'একটা ইনভয়েসে চাপলে পুরোটা খুলবে: PDF, পার্সেল পাঠানো, টাকা নেওয়া।',
      'বাকি টাকা নিতে: "Receive / adjust due" → টাকার পরিমাণ আর মাধ্যম।',
      'মাল ফেরত এলে: "Return" → কোন পণ্য কয়টা, ভালো না নষ্ট, টাকা ফেরত না ক্রেডিট। ভালো মাল যে লট থেকে বিক্রি হয়েছিল সেই লটেই ফিরে যায়।',
      'ভুল ইনভয়েস মোছা হয় না — "Cancel sale" করলে মাল ফেরত আসে আর হিসাব ঠিক থাকে।'] },
    en: { t: 'Sales, dues and returns', s: [
      '"Sales" lists every invoice; the cards on top show this month\'s sales, orders and dues.',
      'Press an invoice to open it: the PDF, sending the parcel, taking money.',
      'To take a due: "Receive / adjust due" -> the amount and how it was paid.',
      'Goods coming back: "Return" -> which products and how many, good or damaged, money back or credit. Good goods go back into the very lot they were sold from.',
      'A wrong invoice is never deleted: "Cancel sale" brings the goods back and keeps the books right.'] } },

  { id: 'preorders', view: 'preorders',
    bn: { t: 'প্রি-অর্ডার ও অগ্রিম টাকা', s: [
      '"Pre-orders" → "+ New pre-order"। ফোন, নাম, কী চায় (পণ্য বা তালিকায় না থাকা মডেলের নাম), পরিমাণ আর ঠিক করা দাম।',
      '"Deposit now"-এ অগ্রিম টাকা লিখুন। এটা কাস্টমারের টাকা — বিক্রি বা লাভ নয়, যতক্ষণ না মাল দেওয়া হয়।',
      'পরে আরো টাকা দিলে "+ Deposit"।',
      'মাল এলে প্রি-অর্ডার "Ready" হবে। একটা পণ্য কম থাকলে আগে যে অর্ডার দিয়েছে সে আগে পাবে। সেই মাল তার জন্য রাখা থাকে, অন্য কেউ কিনতে পারে না।',
      'মাল দিতে "Hand over" — ঠিক করা দামে ইনভয়েস হবে, অগ্রিম টাকা তাতে কাটা যাবে।',
      'বাতিল হলে "Cancel": টাকা ফেরত, অথবা (শুধু মালিক, কারণ লিখে) টাকা রেখে দেওয়া — তখন সেটা সেই মাসের আয়।'] },
    en: { t: 'Pre-orders and deposits', s: [
      '"Pre-orders" -> "+ New pre-order": phone, name, what they want (a product, or the name of a model not in the list yet), quantity and the agreed price.',
      'Type the deposit in "Deposit now". It is the customer\'s money - not a sale, not profit - until the goods are handed over.',
      'More money later: "+ Deposit".',
      'When the goods arrive the pre-order turns "Ready". If there are fewer than ordered, whoever ordered first gets them first, and those units are held: nobody else can buy them.',
      'To give the goods: "Hand over" - an invoice at the agreed price, paid by the deposit.',
      'Cancelled: "Cancel" - pay the deposit back, or (owner only, with a reason) keep it; then it is income of that month.'] } },

  { id: 'customers', view: 'customers',
    bn: { t: 'কাস্টমার, ফলো-আপ, তথ্য মুছে ফেলা', s: [
      '"Customers"-এ সবাই, কে কত টাকা বাকি রেখেছে।',
      'কাউকে নির্দিষ্ট দিনে ফোন করতে হলে "+ Follow-up" — তারিখ আর কী বিষয়ে। দেরি হলে লাল দেখাবে। কাজ শেষ হলে "Done" আর কী হলো লিখুন।',
      'একজন কাস্টমারে চাপলে "At a glance": পছন্দের রং, ব্র্যান্ড, শেষ কবে কিনেছে, মোট কত কিনেছে।',
      'কাস্টমার নিজের তথ্য মুছে দিতে বললে (শুধু মালিক): তার পেজে "Remove personal data…", কারণ লিখুন আর তার নাম হুবহু টাইপ করুন। নাম, ফোন, ঠিকানা সব জায়গা থেকে মুছে "Removed customer N" হবে; টাকার হিসাব বদলাবে না। এটা ফেরানো যায় না।',
      'বাকি থাকলে, ক্রেডিট থাকলে বা খোলা প্রি-অর্ডার থাকলে মোছা যাবে না — আগে সেগুলো মিটিয়ে নিন।'] },
    en: { t: 'Customers, follow-ups, removing personal data', s: [
      '"Customers" lists everyone and what they owe.',
      'Someone to call on a day: "+ Follow-up" - when and about what. Late ones show red; "Done" asks what came of it.',
      'Press a customer for "At a glance": favourite colour and brand, when they last bought, how much in all.',
      'A customer asks to be forgotten (owner only): on their page "Remove personal data...", give the reason and type their name exactly. Name, phone and address go everywhere and they become "Removed customer N"; the money figures do not change. It cannot be undone.',
      'Not possible while they owe, hold credit or have an open pre-order - settle those first.'] } },

  { id: 'receive', view: 'stock',
    bn: { t: 'মাল রিসিভ করা (শিপমেন্ট)', s: [
      '"Stock entry" → মাল কোথা থেকে এলো: শিপমেন্ট, লোকাল কেনা ইত্যাদি। শিপমেন্ট নম্বর আর সাপ্লায়ার লিখুন।',
      'পণ্য আর পরিমাণ যোগ করুন। নতুন পণ্য হলে এখানেই তৈরি করা যায়।',
      'দাম: বিদেশি টাকায় মোট (যেমন RMB) আর রেট, অথবা টাকায় মোট।',
      'শিপিং: "Sea" বা "Air" বেছে ওজনের ঘর ফাঁকা রাখলে ইআরপি প্রতিটা পণ্যের চার্জেবল ওজন (আসল ওজন আর বাক্সের মাপের ওজন — যেটা বেশি) × কেজি প্রতি রেট দিয়ে ফ্রেইট হিসাব করবে। এর জন্য পণ্যের ওজন দেওয়া থাকতে হবে (Shipments → "Product sizes")।',
      'কাস্টমস, এজেন্ট ইত্যাদি খরচ "+ Add a cost"-এ। "Split costs by" দিয়ে ভাগ: ওজন, দাম বা পিস অনুযায়ী।',
      'সেভ করলে প্রতিটা পণ্যের landed cost (মাল + সব খরচের ভাগ) দিয়ে একটা লট তৈরি হয়। বিক্রি হবে পুরনো লট আগে (FIFO)।'] },
    en: { t: 'Receiving goods (a shipment)', s: [
      '"Stock entry" -> where it came from: a shipment, a local buy ... Type the shipment number and the supplier.',
      'Add the products and quantities. A new product can be made right here.',
      'Prices: the total in the supplier\'s currency (e.g. RMB) and the rate, or the total in taka.',
      'Shipping: choose "Sea" or "Air" and leave the weight empty - the ERP charges each product\'s chargeable weight (its real weight or its box weight, the larger) x the rate per kg. Products need a weight for that (Shipments -> "Product sizes").',
      'Customs, agent and other costs in "+ Add a cost". "Split costs by": weight, value or units.',
      'Saving makes one lot per product at its landed cost (goods + its share of every cost). The oldest lots sell first (FIFO).'] } },

  { id: 'shipments', view: 'shipments',
    bn: { t: 'শিপমেন্ট, পথে থাকা অর্ডার, দেরিতে আসা বিল', s: [
      '"Shipments"-এ প্রতিটা শিপমেন্ট: কত এলো, কত বাকি, কত বিক্রি, কত লাভ, গুদাম ভাড়ার ভাগ বাদে লাভ।',
      'একটা শিপমেন্টে চাপলে প্রতিটা পণ্যের landed cost, বিক্রি আর লাভ; ফ্রেইট, ডিউটি আর সাপ্লায়ারের বিল।',
      '"On the way": অর্ডার Planned → Ordered → In transit। "In transit…"-এ ট্র্যাকিং নম্বর, এজেন্ট, ওজন, কেজি প্রতি রেট আর কবে আসবে লিখুন।',
      'মাল আসার পরে কোনো বিল এলে: শিপমেন্টের পেজে "+ Add a bill"। যেটুকু মাল বিক্রি হয়ে গেছে তার ভাগ এ মাসের খরচে যায়, বাকিটা তাকে থাকা মালের দামে যোগ হয়।',
      '"Suggested selling prices": landed cost × মার্কআপ। পছন্দেরগুলোতে টিক দিয়ে "Use the ticked prices"। মার্কআপ মালিক ঠিক করেন ("Markups…")।'] },
    en: { t: 'Shipments, orders on the way, late bills', s: [
      '"Shipments" shows every shipment: how much came, is left, sold, the profit, and the profit after its share of rent.',
      'Press one for each product\'s landed cost, sales and profit; the freight, duty and the supplier\'s bill.',
      '"On the way": orders go Planned -> Ordered -> In transit. "In transit..." takes the tracking number, agent, weight, rate per kg and expected date.',
      'A bill that comes after the goods: on the shipment "+ Add a bill". The part for goods already sold is this month\'s cost; the rest is added to the cost of what is still on the shelf.',
      '"Suggested selling prices": landed cost x markup. Tick the ones you want and press "Use the ticked prices". The owner sets the markups ("Markups...").'] } },

  { id: 'products', view: 'products',
    bn: { t: 'পণ্য, ওজন আর বাক্সের মাপ', s: [
      '"Products"-এ সব পণ্য: দাম, স্টক, কতটা পাওয়া যাবে (প্রি-অর্ডারের জন্য রাখা বাদে)।',
      'নতুন পণ্য: "New" → নাম, ক্যাটাগরি, ব্র্যান্ড, বিক্রির দাম।',
      'ওজন আর বাক্সের মাপ একসাথে অনেক পণ্যে দিতে: Shipments → "Product sizes" → একটা ক্যাটাগরি বা একটা পণ্য, ওজন (গ্রাম) আর বাক্স (মিমি)। যেমন ১ কেজির স্পুল: ১৩০০ গ্রাম, ২১০ × ২১০ × ৮০।',
      'ওজন না থাকলে গুদাম ভাড়ার ভাগে পণ্যটা ১ কেজি ধরা হয়, আর সিস্টেম চেক মনে করিয়ে দেবে।'] },
    en: { t: 'Products, weight and box size', s: [
      '"Products" lists everything: price, stock, and what is available (less what is held for pre-orders).',
      'A new product: "New" -> name, category, brand, selling price.',
      'Weight and box size for many products at once: Shipments -> "Product sizes" -> a category or one product, the weight (g) and the box (mm). A 1 kg spool, for example: 1300 g, 210 x 210 x 80.',
      'Without a weight a product counts as 1 kg when rent is shared, and System check reminds you.'] } },

  { id: 'costs', view: 'costs',
    bn: { t: 'পণ্যের খরচ (cost book)', s: [
      '"Product cost"-এ ক্যাটাগরি/ব্র্যান্ড/টাইপ অনুযায়ী কেনা দাম।',
      'নতুন শিপমেন্ট থেকে আসা মালের খরচ লট থেকেই আসে (FIFO)। কিন্তু লট শুরুর আগের পুরনো মাল এই cost book-এর দামে বিক্রি হয়।',
      'তাই cost book হালনাগাদ রাখুন — না হলে সেই পণ্যের লাভ ভুল দেখাবে। সিস্টেম চেক বলে দেয় কোন পণ্যের খরচ নেই।'] },
    en: { t: 'Product cost (the cost book)', s: [
      '"Product cost" holds the buying price by category / brand / type.',
      'Goods from a new shipment take their cost from their lot (FIFO). Older stock from before lots began sells at the cost book\'s price.',
      'So keep the cost book up to date - otherwise those products\' profit is wrong. System check tells you which products have no cost.'] } },

  { id: 'cash', view: 'cash',
    bn: { t: 'টাকার হিসাব, ক্যাশ-আপ, এজেন্টের অগ্রিম', s: [
      '"Money"-এ প্রতিটা অ্যাকাউন্ট (Cash, ব্যাংক, bKash, কুরিয়ার) আর তার ব্যালান্স।',
      'দিনশেষে ক্যাশ গোনা: "Count an account" → অ্যাকাউন্ট বাছুন, নোট গুনে লিখুন (১০০০ কয়টা, ৫০০ কয়টা ...) বা মোট লিখুন। খাতার সাথে না মিললে কারণ লিখতে হবে; পার্থক্যটা অ্যাকাউন্টে বসে যায়।',
      'কার্গো এজেন্টকে আগে টাকা দিলে: "Agent advance" ধরনের একটা অ্যাকাউন্ট খুলুন, টাকা ট্রান্সফার করুন। মাল রিসিভের সময় ফ্রেইটের "Paid from"-এ সেই অ্যাকাউন্ট বাছুন — ব্যালান্স কমবে। এই টাকা হাতের টাকা ধরা হয় না।',
      'ক্যাশ-আপ আর ব্যালান্স শুধু মালিক ও শেয়ারহোল্ডার দেখেন।'] },
    en: { t: 'Money, cash-up, the agent\'s advance', s: [
      '"Money" shows every account (Cash, bank, bKash, courier) and its balance.',
      'Counting at the end of the day: "Count an account" -> the account, then the notes counted (how many 1000s, 500s ...) or the total. If it differs from the book you must say why; the difference is booked on the account.',
      'Money advanced to a cargo agent: open an account of the kind "Agent advance" and transfer to it. On receiving, choose it in "Paid from" for the freight - its balance goes down. It is not counted as money in hand.',
      'Cash-up and balances are for the owner and shareholders only.'] } },

  { id: 'expenses', view: 'expenses',
    bn: { t: 'খরচ আর গুদাম ভাড়া (holding cost)', s: [
      '"Expenses"-এ মাসের সব খরচ: প্রতি মাসের নির্দিষ্ট খরচ (ভাড়া ইত্যাদি) আর অন্যগুলো।',
      'গুদাম/দোকান ভাড়া (Rent) প্রতি মাসে তাকে থাকা স্টকের উপর ওজন × দিন অনুযায়ী ভাগ হয়। এতে নেট লাভ বদলায় না, কিন্তু কোন শিপমেন্ট ভাড়া বাদে আসলে কত লাভ করলো সেটা দেখা যায়।',
      'কোন খরচ ভাড়া হিসেবে ধরা হবে তা মালিক ঠিক করেন: Shipments → "Holding cost…"।',
      'কমিশন আর ইনভেস্টরের রিটার্নও এখানে মাসের খরচ হিসেবে দেখায়।'] },
    en: { t: 'Expenses and holding cost', s: [
      '"Expenses" holds the month\'s costs: the fixed ones (rent ...) and the rest.',
      'Rent is shared every month over the stock on the shelf by weight x days. Net profit does not change, but you see what each shipment really made after rent.',
      'The owner chooses which expenses count as holding cost: Shipments -> "Holding cost...".',
      'Commission and investors\' returns also show here as costs of the month.'] } },

  { id: 'capital', view: 'capital',
    bn: { t: 'ইনভেস্টর আর শিপমেন্টে বিনিয়োগ', s: [
      '"Capital"-এ মালিক, শেয়ারহোল্ডার আর ইনভেস্টর; কে কত টাকা দিয়েছে, কত রিটার্ন পাওনা।',
      'শিপমেন্টের লাভের ভাগ পাবে এমন ইনভেস্টর: যোগ করার সময় রিটার্ন "Share of profit on shipments they fund" আর লাভের কত %।',
      'কোন শিপমেন্টের কত অংশ সে দিয়েছে: সেই শিপমেন্টের পেজে "Funded by" → ইনভেস্টর আর %। তার অংশ বিক্রি হলে (গুদাম ভাড়ার ভাগ বাদে) লাভের ভাগ তার পাওনা হয়।',
      'ইনভেস্টর নিজে দেখতে পারে: "Investor pages" → "Make page link"। লিংক পাঠান, আর ৮ অঙ্কের কোডটা আলাদা করে (ফোনে) বলুন। সে শুধু নিজের হিসাব দেখবে।'] },
    en: { t: 'Investors and funding a shipment', s: [
      '"Capital" lists owners, shareholders and investors: who put in what, and the returns owed.',
      'An investor paid from shipment profit: when adding them choose the return "Share of profit on shipments they fund" and the % of the profit.',
      'Which part of a shipment they paid for: on that shipment "Funded by" -> the investor and the %. When their part sells, their share of the profit (after rent) is owed to them.',
      'The investor can see it themselves: "Investor pages" -> "Make page link". Send the link and say the 8-digit code separately (by phone). They see only their own figures.'] } },

  { id: 'commission', view: 'commission',
    bn: { t: 'কমিশন', s: [
      '"Commission"-এ মাসে কে কত কমিশন পেলো, কত দেওয়া হয়েছে, কত বাকি।',
      'নিয়ম (শুধু মালিক): "+ Rule" → কার জন্য (সবাই বা একজন), কিসে (সব, একটা ক্যাটাগরি, ব্র্যান্ড বা পণ্য), বিক্রির না লাভের কত %। সবচেয়ে নির্দিষ্ট নিয়মটা খাটে।',
      'যে ইনভয়েস বানায় কমিশন তার। মাল ফেরত এলে কমিশনও কমে।',
      'কমিশন যে মাসে হয় সেই মাসের খরচ। দিতে "Pay" — দুবার খরচ ধরা হয় না।',
      'বিক্রয়কর্মী শুধু নিজের কমিশন দেখেন।'] },
    en: { t: 'Commission', s: [
      '"Commission" shows who earned how much this month, what was paid and what is left.',
      'Rules (owner only): "+ Rule" -> for whom (everyone or one person), on what (everything, a category, a brand or a product), a % of the sales or of the profit. The most specific rule wins.',
      'Commission belongs to whoever made the invoice. A return takes it back.',
      'Commission is a cost of the month it is earned in. "Pay" records the payment without counting it twice.',
      'Sales staff see only their own.'] } },

  { id: 'profit', view: 'profit',
    bn: { t: 'লাভ-ক্ষতি (Profitability)', s: [
      'প্রতি মাসের বিক্রি, বিক্রি হওয়া মালের খরচ, গ্রস লাভ, খরচ আর নেট লাভ।',
      'বিক্রি হওয়া মালের খরচ আসে ঠিক যে লট থেকে মাল বিক্রি হয়েছে তার landed cost থেকে (FIFO) — বিক্রির দিনই বিলে লেখা থাকে, পরে বদলায় না।',
      'নেট লাভ = গ্রস লাভ + ডেলিভারি চার্জ − কুরিয়ারের খরচ + রিপেয়ার আয় − খরচ (ভাড়া, কমিশন, ইনভেস্টরের রিটার্ন সহ) + রেখে দেওয়া প্রি-অর্ডারের টাকা।',
      'বন্ধ করা মাস (month lock) আর বদলানো যায় না।'] },
    en: { t: 'Profit and loss (Profitability)', s: [
      'Each month: sales, the cost of the goods sold, gross profit, expenses and net profit.',
      'The cost of goods sold comes from the very lot each unit came from (FIFO) - written on the invoice the day it is sold, never changed later.',
      'Net profit = gross profit + delivery charged - courier fees + repair income - expenses (rent, commission and investors\' returns included) + pre-order deposits kept.',
      'A closed month (month lock) cannot be changed.'] } },

  { id: 'analytics', view: 'analytics',
    bn: { t: 'অ্যানালিটিক্স', s: [
      '"Shipment ROI": প্রতিটা শিপমেন্টে খরচের তুলনায় কত % লাভ (ভাড়া বাদে)।',
      '"Dead stock": ৯০ দিনের বেশি তাকে আছে আর ৬০ দিনে একটাও বিক্রি হয়নি — এগুলো আবার আনার আগে ভাবুন।',
      '"Colours": গত ৯০ দিনে কোন রং বেশি বিক্রি।',
      '"12 months": প্রতি মাসের বিক্রি, গ্রস আর নেট লাভ।'] },
    en: { t: 'Analytics', s: [
      '"Shipment ROI": each shipment\'s profit (after rent) against what it cost.',
      '"Dead stock": on the shelf over 90 days with nothing sold in 60 - think before ordering them again.',
      '"Colours": which colours sold most in the last 90 days.',
      '"12 months": sales, gross and net profit month by month.'] } },

  { id: 'syscheck', view: 'syscheck',
    bn: { t: 'সিস্টেম চেক', s: [
      'ইআরপি নিজের হিসাব নিজেই মিলিয়ে দেখে: লটের মাল = স্টক, ইনভয়েসের যোগফল ঠিক, কেউ বিলের বেশি দেয়নি, শেয়ার ১০০%-এর বেশি না, ড্যাশবোর্ডের লাভ = লাভ-ক্ষতির লাভ।',
      '"Pass" মানে ঠিক আছে, "Look" মানে দেখা দরকার (যেমন পণ্যের খরচ বা ওজন নেই), "Fail" মানে হিসাবে গরমিল।',
      'Look বা Fail-এর সারিতে চাপলে যেখানে ঠিক করতে হবে সেই স্ক্রিন খুলবে। "Check again" দিয়ে আবার চালান।'] },
    en: { t: 'System check', s: [
      'The ERP checks its own books: lots hold exactly the stock, invoices add up, nobody paid more than they owed, shares are within 100%, the dashboard\'s profit equals the P&L\'s.',
      '"Pass" is fine, "Look" needs a look (a product without cost or weight), "Fail" means the books do not agree.',
      'Press a Look or Fail row to open the screen where it is fixed. "Check again" runs it again.'] } },

  { id: 'words', view: '',
    bn: { t: 'শব্দকোষ', s: [
      'লট (lot): একসাথে এক দামে আসা মাল। প্রতিটা পিস কোনো না কোনো লটের।',
      'FIFO: আগে আসা মাল আগে বিক্রি। বিক্রির খরচ সেই পুরনো লটের দাম।',
      'Landed cost: মাল দোকানে পৌঁছাতে মোট যা খরচ — মালের দাম + ফ্রেইট + কাস্টমস + এজেন্ট ... প্রতি পিস।',
      'চার্জেবল ওজন: আসল ওজন আর বাক্সের মাপের ওজন (দৈর্ঘ্য × প্রস্থ × উচ্চতা ÷ ৬০০০) — যেটা বেশি। কার্গো এই ওজনে টাকা নেয়।',
      'Holding cost: মাল রাখার খরচ (গুদাম/দোকান ভাড়া) — মাসে স্টকের উপর ওজন × দিন অনুযায়ী ভাগ।',
      'অগ্রিম/ডিপোজিট: কাস্টমারের দেওয়া আগাম টাকা — মাল না দেওয়া পর্যন্ত তার টাকা, আমাদের আয় নয়।',
      'ROI: খরচের তুলনায় লাভ কত %।'] },
    en: { t: 'Glossary', s: [
      'Lot: goods that came in together at one cost. Every unit belongs to a lot.',
      'FIFO: first in, first out - the oldest goods sell first, at that old lot\'s cost.',
      'Landed cost: everything it took to get a unit onto the shelf - its price + freight + customs + agent ...',
      'Chargeable weight: the real weight or the box weight (length x width x height / 6000), whichever is more. Cargo charges by it.',
      'Holding cost: what keeping stock costs (rent) - shared monthly over the stock by weight x days.',
      'Deposit / advance: money a customer pays ahead - theirs until the goods are handed over, not our income.',
      'ROI: profit as a % of what was spent.'] } }
];
