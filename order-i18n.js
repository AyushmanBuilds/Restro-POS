/* =====================================================================
   ATITHYA — customer language switcher: English / हिन्दी / ଓଡ଼ିଆ
   Load on order.html BEFORE order.js (plain <script>, not a module).

   How it works (nothing in your ordering logic changes):
   - Order data (what the kitchen and bills see) always stays English.
   - Only what the customer READS is swapped, live, in the browser.
   - Menu items: uses the Hindi / Odia name the owner typed in the item
     editor (name_hi / name_or). If blank, common dishes are translated
     from the built-in glossary below. Anything unknown stays English.
   - Review the Odia text with a native speaker before you go live.
   ===================================================================== */
(function () {
  "use strict";

  var KEY = "ord_lang";
  var LANGS = [["en", "EN"], ["hi", "हिं"], ["or", "ଓଡ଼ି"]];
  var LANG_NAMES = { en: "English", hi: "हिन्दी", or: "ଓଡ଼ିଆ" };
  var IDX = { hi: 0, or: 1 };

  /* ---------------------------------------------------------------
     1. UI TEXT  — English : [Hindi, Odia]
     --------------------------------------------------------------- */
  var UI = {
    /* screens + errors */
    "Loading menu…": ["मेन्यू लोड हो रहा है…", "ମେନୁ ଲୋଡ୍ ହେଉଛି…"],
    "Ordering isn't open right now": ["अभी ऑर्डरिंग उपलब्ध नहीं है", "ବର୍ତ୍ତମାନ ଅର୍ଡର୍ ଖୋଲା ନାହିଁ"],
    "Please call a staff member to place your order.": ["कृपया ऑर्डर देने के लिए स्टाफ को बुलाएँ।", "ଅର୍ଡର୍ ଦେବା ପାଇଁ ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କୁ ଡାକନ୍ତୁ।"],
    "Something's not right": ["कुछ गड़बड़ है", "କିଛି ଠିକ୍ ନାହିଁ"],
    "This QR code link looks invalid. Please ask staff for help.": ["यह QR कोड लिंक सही नहीं लगता। कृपया स्टाफ से मदद लें।", "ଏହି QR କୋଡ୍ ଲିଙ୍କ୍ ଠିକ୍ ଦେଖାଯାଉନାହିଁ। ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କ ସାହାଯ୍ୟ ନିଅନ୍ତୁ।"],
    "We couldn't find this restaurant. Please ask staff for help.": ["यह रेस्टोरेंट नहीं मिला। कृपया स्टाफ से मदद लें।", "ଏହି ରେଷ୍ଟୁରାଣ୍ଟ ମିଳିଲା ନାହିଁ। ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କ ସାହାଯ୍ୟ ନିଅନ୍ତୁ।"],
    "We couldn't load the menu right now. Please ask staff for help or try again.": ["अभी मेन्यू लोड नहीं हो सका। कृपया स्टाफ से मदद लें या दोबारा कोशिश करें।", "ବର୍ତ୍ତମାନ ମେନୁ ଲୋଡ୍ ହୋଇପାରିଲା ନାହିଁ। ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କ ସାହାଯ୍ୟ ନିଅନ୍ତୁ କିମ୍ବା ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।"],

    /* seat screen */
    "Pick your seat(s)": ["अपनी सीट चुनें", "ଆପଣଙ୍କ ସିଟ୍ ବାଛନ୍ତୁ"],
    "Seat": ["सीट", "ସିଟ୍"],
    "✓ Selected": ["✓ चुनी गई", "✓ ବଛା ହୋଇଛି"],
    "Select at least one seat": ["कम से कम एक सीट चुनें", "ଅତିକମରେ ଗୋଟିଏ ସିଟ୍ ବାଛନ୍ତୁ"],
    "Confirm": ["पुष्टि करें", "ନିଶ୍ଚିତ କରନ୍ତୁ"],

    /* hero + header */
    "Fresh from our kitchen": ["हमारी रसोई से ताज़ा", "ଆମ ରୋଷେଇ ଘରୁ ତାଜା"],
    "Pick your favourites and we'll bring them to your table.": ["अपनी पसंद चुनें, हम उन्हें आपकी टेबल पर लाएँगे।", "ଆପଣଙ୍କ ପସନ୍ଦ ବାଛନ୍ତୁ, ଆମେ ଆପଣଙ୍କ ଟେବୁଲକୁ ଆଣିଦେବୁ।"],
    "Track order": ["ऑर्डर ट्रैक करें", "ଅର୍ଡର୍ ଟ୍ରାକ୍ କରନ୍ତୁ"],
    "Table": ["टेबल", "ଟେବୁଲ୍"],
    "Search dishes and drinks": ["व्यंजन और पेय खोजें", "ଖାଦ୍ୟ ଓ ପାନୀୟ ଖୋଜନ୍ତୁ"],
    "Search the menu": ["मेन्यू में खोजें", "ମେନୁରେ ଖୋଜନ୍ତୁ"],
    "Clear search": ["खोज हटाएँ", "ଖୋଜା ସଫା କରନ୍ତୁ"],
    "Categories": ["श्रेणियाँ", "ବିଭାଗ"],
    "Browse the menu": ["मेन्यू देखें", "ମେନୁ ଦେଖନ୍ତୁ"],
    "Close": ["बंद करें", "ବନ୍ଦ କରନ୍ତୁ"],
    "Veg": ["शाकाहारी", "ନିରାମିଷ"],
    "Non-veg": ["मांसाहारी", "ଆମିଷ"],
    "Food type": ["भोजन का प्रकार", "ଖାଦ୍ୟ ପ୍ରକାର"],
    "Language": ["भाषा", "ଭାଷା"],

    /* dietary tags (owner sets these per dish) */
    "Dietary needs": ["खान-पान की ज़रूरतें", "ଖାଦ୍ୟ ଆବଶ୍ୟକତା"],
    "Jain": ["जैन", "ଜୈନ"],
    "No onion/garlic": ["बिना प्याज़/लहसुन", "ପିଆଜ/ରସୁଣ ନାହିଁ"],
    "Vrat / fasting": ["व्रत / उपवास", "ବ୍ରତ / ଉପବାସ"],
    "Vegan": ["वीगन", "ଭିଗାନ୍"],
    "Eggless": ["बिना अंडा", "ଅଣ୍ଡା ନାହିଁ"],
    "Gluten-free": ["ग्लूटेन-मुक्त", "ଗ୍ଲୁଟେନ୍-ମୁକ୍ତ"],
    "Contains nuts": ["मेवे/नट्स हैं", "ବାଦାମ/ନଟ୍ସ ଅଛି"],
    "Sold out": ["खत्म हो गया", "ସରିଯାଇଛି"],
    "No dishes match these filters.": ["इन फ़िल्टर से कोई व्यंजन नहीं मिला।", "ଏହି ଫିଲ୍ଟରରେ କୌଣସି ଖାଦ୍ୟ ମିଳିଲା ନାହିଁ।"],
    "Dish photos by": ["व्यंजन की तस्वीरें:", "ଖାଦ୍ୟ ଫଟୋ:"],
    "· Powered by Atithya": ["· Atithya द्वारा संचालित", "· Atithya ଦ୍ୱାରା ଚାଳିତ"],
    "Please tell our staff about any allergies.": ["किसी भी एलर्जी के बारे में कृपया स्टाफ को बताएँ।", "କୌଣସି ଆଲର୍ଜି ଥିଲେ ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କୁ କୁହନ୍ତୁ।"],

    /* menu cards, sheets */
    "Select": ["चुनें", "ବାଛନ୍ତୁ"],
    "Add": ["जोड़ें", "ଯୋଗ କରନ୍ତୁ"],
    "+ Add": ["+ जोड़ें", "+ ଯୋଗ କରନ୍ତୁ"],
    "✓ Added": ["✓ जुड़ गया", "✓ ଯୋଗ ହେଲା"],
    "Item": ["आइटम", "ଆଇଟମ୍"],
    "Choose an option": ["एक विकल्प चुनें", "ଗୋଟିଏ ବିକଳ୍ପ ବାଛନ୍ତୁ"],
    "Add-ons": ["ऐड-ऑन", "ଆଡ୍-ଅନ୍"],
    "Quantity": ["मात्रा", "ପରିମାଣ"],
    "Menu isn't available right now.": ["अभी मेन्यू उपलब्ध नहीं है।", "ବର୍ତ୍ତମାନ ମେନୁ ଉପଲବ୍ଧ ନାହିଁ।"],
    "Menu": ["मेन्यू", "ମେନୁ"],
    "Uncategorised": ["अन्य", "ଅନ୍ୟାନ୍ୟ"],
    "🔔 Call waiter": ["🔔 वेटर को बुलाएँ", "🔔 ୱେଟରଙ୍କୁ ଡାକନ୍ତୁ"],
    "Notifying staff…": ["स्टाफ को सूचित किया जा रहा है…", "ଷ୍ଟାଫ୍‌ଙ୍କୁ ଜଣାଉଛୁ…"],
    "✨ Goes great together": ["✨ साथ में बढ़िया लगता है", "✨ ଏକାଠି ଭଲ ଲାଗେ"],

    /* cart */
    "🛒 View order": ["🛒 ऑर्डर देखें", "🛒 ଅର୍ଡର୍ ଦେଖନ୍ତୁ"],
    "Your order": ["आपका ऑर्डर", "ଆପଣଙ୍କ ଅର୍ଡର୍"],
    "Your order is empty.": ["आपका ऑर्डर खाली है।", "ଆପଣଙ୍କ ଅର୍ଡର୍ ଖାଲି ଅଛି।"],
    "Total": ["कुल", "ମୋଟ"],
    "Your name": ["आपका नाम", "ଆପଣଙ୍କ ନାମ"],
    "*required": ["*ज़रूरी", "*ଆବଶ୍ୟକ"],
    "WhatsApp / mobile number": ["व्हाट्सऐप / मोबाइल नंबर", "ହ୍ୱାଟସ୍ଆପ୍ / ମୋବାଇଲ୍ ନମ୍ବର"],
    "So staff know who ordered": ["ताकि स्टाफ को पता रहे किसने ऑर्डर किया", "ଯେପରି ଷ୍ଟାଫ୍ ଜାଣିବେ କିଏ ଅର୍ଡର୍ କଲା"],
    "10-digit mobile number": ["10 अंकों का मोबाइल नंबर", "10 ଅଙ୍କର ମୋବାଇଲ୍ ନମ୍ବର"],
    "We'll send your bill on WhatsApp": ["हम आपका बिल व्हाट्सऐप पर भेजेंगे", "ଆମେ ଆପଣଙ୍କ ବିଲ୍ ହ୍ୱାଟସ୍ଆପ୍‌ରେ ପଠାଇବୁ"],
    "Send order to kitchen": ["ऑर्डर रसोई में भेजें", "ଅର୍ଡର୍ ରୋଷେଇ ଘରକୁ ପଠାନ୍ତୁ"],
    "Sending…": ["भेज रहे हैं…", "ପଠାଉଛୁ…"],
    "Please enter your name before sending the order — it helps staff find you at the table.": ["ऑर्डर भेजने से पहले कृपया अपना नाम लिखें — इससे स्टाफ आपको टेबल पर पहचान पाएगा।", "ଅର୍ଡର୍ ପଠାଇବା ପୂର୍ବରୁ ଦୟାକରି ଆପଣଙ୍କ ନାମ ଲେଖନ୍ତୁ — ଏହା ଷ୍ଟାଫ୍‌ଙ୍କୁ ଟେବୁଲରେ ଆପଣଙ୍କୁ ଚିହ୍ନିବାରେ ସାହାଯ୍ୟ କରେ।"],
    "Please enter a valid 10-digit mobile number — we'll send your bill on WhatsApp.": ["कृपया सही 10 अंकों का मोबाइल नंबर लिखें — हम आपका बिल व्हाट्सऐप पर भेजेंगे।", "ଦୟାକରି ସଠିକ୍ 10 ଅଙ୍କର ମୋବାଇଲ୍ ନମ୍ବର ଲେଖନ୍ତୁ — ଆମେ ଆପଣଙ୍କ ବିଲ୍ ହ୍ୱାଟସ୍ଆପ୍‌ରେ ପଠାଇବୁ।"],
    "Couldn't send your order — please try again or call staff.": ["ऑर्डर नहीं भेजा जा सका — कृपया दोबारा कोशिश करें या स्टाफ को बुलाएँ।", "ଅର୍ଡର୍ ପଠାଯାଇପାରିଲା ନାହିଁ — ଦୟାକରି ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ କିମ୍ବା ଷ୍ଟାଫ୍‌ଙ୍କୁ ଡାକନ୍ତୁ।"],
    "Couldn't reach staff — please wave someone down directly.": ["स्टाफ तक सूचना नहीं पहुँची — कृपया किसी को सीधे बुला लें।", "ଷ୍ଟାଫ୍‌ଙ୍କ ପାଖରେ ପହଞ୍ଚିପାରିଲା ନାହିଁ — ଦୟାକରି ସିଧାସଳଖ କାହାକୁ ଡାକନ୍ତୁ।"],

    /* tracker */
    "Checking your order…": ["आपका ऑर्डर देख रहे हैं…", "ଆପଣଙ୍କ ଅର୍ଡର୍ ଯାଞ୍ଚ କରୁଛୁ…"],
    "Just a moment": ["बस एक पल", "ଟିକେ ଅପେକ୍ଷା କରନ୍ତୁ"],
    "Order sent": ["ऑर्डर भेज दिया गया", "ଅର୍ଡର୍ ପଠାଯାଇଛି"],
    "The kitchen has it.": ["रसोई को मिल गया है।", "ରୋଷେଇ ଘର ପାଇଗଲା।"],
    "Order received": ["ऑर्डर मिल गया", "ଅର୍ଡର୍ ମିଳିଲା"],
    "We've got it! Waiting for staff to confirm.": ["हमें मिल गया! स्टाफ की पुष्टि का इंतज़ार है।", "ଆମେ ପାଇଲୁ! ଷ୍ଟାଫ୍‌ଙ୍କ ନିଶ୍ଚିତକରଣ ଅପେକ୍ଷାରେ।"],
    "Order confirmed": ["ऑर्डर कन्फ़र्म हो गया", "ଅର୍ଡର୍ ନିଶ୍ଚିତ ହେଲା"],
    "Sent to the kitchen — they'll start shortly.": ["रसोई में भेज दिया गया — वे जल्द शुरू करेंगे।", "ରୋଷେଇ ଘରକୁ ପଠାଯାଇଛି — ଶୀଘ୍ର ଆରମ୍ଭ କରିବେ।"],
    "Being prepared": ["तैयार हो रहा है", "ପ୍ରସ୍ତୁତ ହେଉଛି"],
    "Your food is being cooked right now.": ["आपका खाना अभी बन रहा है।", "ଆପଣଙ୍କ ଖାଦ୍ୟ ବର୍ତ୍ତମାନ ରନ୍ଧା ହେଉଛି।"],
    "Ready — on its way!": ["तैयार — आ रहा है!", "ପ୍ରସ୍ତୁତ — ଆସୁଛି!"],
    "Your order has left the kitchen and is coming to your table.": ["आपका ऑर्डर रसोई से निकल चुका है और आपकी टेबल पर आ रहा है।", "ଆପଣଙ୍କ ଅର୍ଡର୍ ରୋଷେଇ ଘରୁ ବାହାରିଛି ଏବଂ ଆପଣଙ୍କ ଟେବୁଲକୁ ଆସୁଛି।"],
    "Served — enjoy!": ["परोस दिया गया — आनंद लें!", "ପରିବେଷିତ — ଉପଭୋଗ କରନ୍ତୁ!"],
    "Hope you love it. You can order more anytime.": ["उम्मीद है आपको पसंद आएगा। आप कभी भी और ऑर्डर कर सकते हैं।", "ଆଶା କରୁଛୁ ଆପଣ ପସନ୍ଦ କରିବେ। ଆପଣ ଯେକୌଣସି ସମୟରେ ଆଉ ଅର୍ଡର୍ କରିପାରିବେ।"],
    "Order couldn't be accepted": ["ऑर्डर स्वीकार नहीं हो सका", "ଅର୍ଡର୍ ଗ୍ରହଣ ହୋଇପାରିଲା ନାହିଁ"],
    "Please call a staff member and we'll sort it out.": ["कृपया स्टाफ को बुलाएँ, हम इसे ठीक कर देंगे।", "ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କୁ ଡାକନ୍ତୁ, ଆମେ ସମାଧାନ କରିବୁ।"],
    "Not accepted": ["स्वीकार नहीं हुआ", "ଗ୍ରହଣ ହୋଇନାହିଁ"],
    "Sorry — this order couldn't be accepted. Please speak to a staff member.": ["क्षमा करें — यह ऑर्डर स्वीकार नहीं हो सका। कृपया स्टाफ से बात करें।", "କ୍ଷମା କରନ୍ତୁ — ଏହି ଅର୍ଡର୍ ଗ୍ରହଣ ହୋଇପାରିଲା ନାହିଁ। ଦୟାକରି ଷ୍ଟାଫ୍‌ଙ୍କ ସହ କଥା ହୁଅନ୍ତୁ।"],
    "Preparing": ["बन रहा है", "ପ୍ରସ୍ତୁତ ହେଉଛି"],
    "Ready": ["तैयार", "ପ୍ରସ୍ତୁତ"],
    "Served": ["परोसा गया", "ପରିବେଷିତ"],
    "Your order is with our team": ["आपका ऑर्डर हमारी टीम के पास है", "ଆପଣଙ୍କ ଅର୍ଡର୍ ଆମ ଟିମ୍ ପାଖରେ ଅଛି"],
    "The kitchen is cooking it": ["रसोई में बन रहा है", "ରୋଷେଇ ଘରେ ରନ୍ଧା ହେଉଛି"],
    "Dispatched from the kitchen": ["रसोई से रवाना", "ରୋଷେଇ ଘରୁ ପଠାଗଲା"],
    "Enjoy your meal!": ["भोजन का आनंद लें!", "ଭୋଜନ ଉପଭୋଗ କରନ୍ତୁ!"],
    "Confirmed and sent to the kitchen": ["कन्फ़र्म होकर रसोई में भेजा गया", "ନିଶ୍ଚିତ ହୋଇ ରୋଷେଇ ଘରକୁ ପଠାଗଲା"],
    "Waiting for staff to confirm": ["स्टाफ की पुष्टि का इंतज़ार", "ଷ୍ଟାଫ୍‌ଙ୍କ ନିଶ୍ଚିତକରଣ ଅପେକ୍ଷା"],
    "+ Order more": ["+ और ऑर्डर करें", "+ ଆଉ ଅର୍ଡର୍ କରନ୍ତୁ"],

    /* checkout + bill */
    "Checkout": ["चेकआउट", "ଚେକଆଉଟ୍"],
    "End this session and checkout?": ["सेशन समाप्त करके चेकआउट करें?", "ସେସନ୍ ଶେଷ କରି ଚେକଆଉଟ୍ କରିବେ?"],
    "Your bill so far": ["अब तक का बिल", "ଏପର୍ଯ୍ୟନ୍ତ ବିଲ୍"],
    "Some of your orders are still on their way — they will still be served.": ["आपके कुछ ऑर्डर अभी रास्ते में हैं — वे आपको परोसे जाएँगे।", "ଆପଣଙ୍କ କିଛି ଅର୍ଡର୍ ଏବେ ବାଟରେ ଅଛି — ସେଗୁଡ଼ିକ ଆପଣଙ୍କୁ ପରିବେଷଣ କରାଯିବ।"],
    "You won't be able to order anything more after this.": ["इसके बाद आप और कुछ ऑर्डर नहीं कर पाएँगे।", "ଏହା ପରେ ଆପଣ ଆଉ କିଛି ଅର୍ଡର୍ କରିପାରିବେ ନାହିଁ।"],
    "Yes, checkout": ["हाँ, चेकआउट करें", "ହଁ, ଚେକଆଉଟ୍ କରନ୍ତୁ"],
    "Not yet, go back": ["अभी नहीं, वापस जाएँ", "ଏବେ ନୁହେଁ, ଫେରିଯାଆନ୍ତୁ"],
    "Checkout complete": ["चेकआउट पूरा हुआ", "ଚେକଆଉଟ୍ ସମ୍ପୂର୍ଣ୍ଣ"],
    "Amount to pay": ["भुगतान की राशि", "ଦେୟ ରାଶି"],
    "Please pay at the Cafe Reception": ["कृपया भुगतान कैफ़े रिसेप्शन पर करें", "ଦୟାକରି କାଫେ ରିସେପ୍ସନରେ ଦେୟ ଦିଅନ୍ତୁ"],
    "Show this screen to our cashier.": ["यह स्क्रीन कैशियर को दिखाएँ।", "ଏହି ସ୍କ୍ରିନ୍ କ୍ୟାସିଅରଙ୍କୁ ଦେଖାନ୍ତୁ।"],
    "Bill summary": ["बिल विवरण", "ବିଲ୍ ବିବରଣୀ"],
    "Name": ["नाम", "ନାମ"],
    "Date": ["तारीख", "ତାରିଖ"],
    "Bill ref": ["बिल संदर्भ", "ବିଲ୍ ରେଫରେନ୍ସ"],
    "Guest": ["अतिथि", "ଅତିଥି"],
    "Taxes and charges, if any, are added in the final bill at the counter.": ["लागू कर और शुल्क, यदि कोई हों, काउंटर पर अंतिम बिल में जोड़े जाएँगे।", "ପ୍ରଯୁଜ୍ୟ କର ଓ ଶୁଳ୍କ, ଯଦି ଥାଏ, କାଉଣ୍ଟରରେ ଅନ୍ତିମ ବିଲ୍‌ରେ ଯୋଗ କରାଯିବ।"],
    "Your bill will be prepared at the reception.": ["आपका बिल रिसेप्शन पर तैयार किया जाएगा।", "ଆପଣଙ୍କ ବିଲ୍ ରିସେପ୍ସନରେ ପ୍ରସ୍ତୁତ କରାଯିବ।"],
    "Thank you for dining with us!": ["हमारे साथ भोजन करने के लिए धन्यवाद!", "ଆମ ସହ ଭୋଜନ କରିଥିବାରୁ ଧନ୍ୟବାଦ!"],
    "This dine-in session has ended ·": ["यह डाइन-इन सेशन समाप्त हो चुका है", "ଏହି ଡାଇନ୍-ଇନ୍ ସେସନ୍ ଶେଷ ହୋଇଛି"],

    /* UPI payment card */
    "Final bill (incl. taxes)": ["अंतिम बिल (कर सहित)", "ଅନ୍ତିମ ବିଲ୍ (କର ସହିତ)"],
    "Pay using any UPI app. The amount is filled in for you.": ["किसी भी UPI ऐप से भुगतान करें। राशि पहले से भरी हुई है।", "ଯେକୌଣସି UPI ଆପ୍‌ରେ ଦେୟ ଦିଅନ୍ତୁ। ରାଶି ଆପେ ଭରାଯାଇଛି।"],
    "Show QR to pay from another phone": ["दूसरे फ़ोन से भुगतान के लिए QR देखें", "ଅନ୍ୟ ଫୋନରୁ ଦେୟ ପାଇଁ QR ଦେଖନ୍ତୁ"],
    "I've paid": ["मैंने भुगतान कर दिया", "ମୁଁ ଦେୟ ଦେଇଛି"],
    "Waiting for the cafe to confirm your payment…": ["कैफ़े द्वारा भुगतान की पुष्टि का इंतज़ार…", "କାଫେ ଆପଣଙ୍କ ଦେୟ ନିଶ୍ଚିତ କରିବା ଅପେକ୍ଷାରେ…"],
    "This usually takes a few seconds.": ["इसमें आमतौर पर कुछ सेकंड लगते हैं।", "ଏଥିରେ ସାଧାରଣତଃ କିଛି ସେକେଣ୍ଡ ଲାଗେ।"],
    "Payment received — thank you!": ["भुगतान मिल गया — धन्यवाद!", "ଦେୟ ମିଳିଲା — ଧନ୍ୟବାଦ!"],
    "We couldn't find your payment yet. Please try again or pay at the reception.": ["हमें आपका भुगतान अभी नहीं मिला। कृपया दोबारा कोशिश करें या रिसेप्शन पर भुगतान करें।", "ଆମକୁ ଆପଣଙ୍କ ଦେୟ ଏପର୍ଯ୍ୟନ୍ତ ମିଳିଲା ନାହିଁ। ଦୟାକରି ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ କିମ୍ବା ରିସେପ୍ସନରେ ଦେୟ ଦିଅନ୍ତୁ।"],
    "Couldn't send that — please tell the cashier.": ["यह भेजा नहीं जा सका — कृपया कैशियर को बताएँ।", "ଏହା ପଠାଯାଇପାରିଲା ନାହିଁ — ଦୟାକରି କ୍ୟାସିଅରଙ୍କୁ କୁହନ୍ତୁ।"],

    /* categories (preset list from the menu builder) */
    "Starters / Appetizers": ["स्टार्टर्स", "ଷ୍ଟାର୍ଟର୍"],
    "Soups": ["सूप", "ସୁପ୍"],
    "Salads": ["सलाद", "ସଲାଡ୍"],
    "Indian Breads": ["भारतीय रोटियाँ", "ଭାରତୀୟ ରୁଟି"],
    "Main Course - Veg": ["मुख्य भोजन - शाकाहारी", "ମୁଖ୍ୟ ଖାଦ୍ୟ - ନିରାମିଷ"],
    "Main Course - Non-Veg": ["मुख्य भोजन - मांसाहारी", "ମୁଖ୍ୟ ଖାଦ୍ୟ - ଆମିଷ"],
    "Rice & Biryani": ["चावल और बिरयानी", "ଭାତ ଓ ବିରିୟାନି"],
    "Noodles & Chinese": ["नूडल्स और चाइनीज़", "ନୁଡୁଲ୍ସ ଓ ଚାଇନିଜ୍"],
    "South Indian": ["साउथ इंडियन", "ସାଉଥ୍ ଇଣ୍ଡିଆନ୍"],
    "Tandoor / Grill": ["तंदूर / ग्रिल", "ତନ୍ଦୁର / ଗ୍ରିଲ୍"],
    "Pizza": ["पिज़्ज़ा", "ପିଜ୍ଜା"],
    "Burgers & Sandwiches": ["बर्गर और सैंडविच", "ବର୍ଗର ଓ ସାଣ୍ଡୱିଚ୍"],
    "Wraps & Rolls": ["रैप्स और रोल", "ର‍୍ୟାପ୍ ଓ ରୋଲ୍"],
    "Pasta": ["पास्ता", "ପାସ୍ତା"],
    "Combos / Thali": ["कॉम्बो / थाली", "କମ୍ବୋ / ଥାଳି"],
    "Desserts": ["मिठाई / डेज़र्ट", "ମିଠା / ଡେଜର୍ଟ"],
    "Beverages": ["पेय पदार्थ", "ପାନୀୟ"],
    "Mocktails & Shakes": ["मॉकटेल और शेक", "ମକଟେଲ୍ ଓ ସେକ୍"],
    "Tea & Coffee": ["चाय और कॉफ़ी", "ଚା ଓ କଫି"],
    "Ice Cream": ["आइसक्रीम", "ଆଇସକ୍ରିମ୍"],
    "Bakery & Snacks": ["बेकरी और स्नैक्स", "ବେକେରୀ ଓ ସ୍ନାକ୍ସ"],
    "Sides & Extras": ["साइड्स और एक्स्ट्रा", "ସାଇଡ୍ସ ଓ ଏକ୍ସଟ୍ରା"]
  };

  /* Sentences with numbers / names inside. fn(match, lang) -> string */
  function P(re, hi, or) { return [re, { hi: hi, or: or }]; }
  var PATTERNS = [
    P(/^Table (.+)$/, "टेबल $1", "ଟେବୁଲ୍ $1"),
    P(/^Confirm — Seats? (.+)$/, "पुष्टि करें — सीट $1", "ନିଶ୍ଚିତ କରନ୍ତୁ — ସିଟ୍ $1"),
    P(/^Seats? (.+)$/, "सीट $1", "ସିଟ୍ $1"),
    P(/^🔔 Waiter notified \((\d+)s\)$/, "🔔 वेटर को सूचित किया ($1s)", "🔔 ୱେଟରଙ୍କୁ ଜଣାଗଲା ($1s)"),
    P(/^Add to order — (.+)$/, "ऑर्डर में जोड़ें — $1", "ଅର୍ଡରରେ ଯୋଗ କରନ୍ତୁ — $1"),
    P(/^From (.+)$/, "$1 से शुरू", "$1 ରୁ ଆରମ୍ଭ"),
    P(/^(\d+) items? · (.+)$/, "$1 आइटम · $2", "$1 ଟି ଆଇଟମ୍ · $2"),
    P(/^(\d+) items?$/, "$1 आइटम", "$1 ଟି ଆଇଟମ୍"),
    P(/^Your bill so far · (\d+) orders?$/, "अब तक का बिल · $1 ऑर्डर", "ଏପର୍ଯ୍ୟନ୍ତ ବିଲ୍ · $1 ଟି ଅର୍ଡର୍"),
    P(/^Order (\d+)$/, "ऑर्डर $1", "ଅର୍ଡର୍ $1"),
    P(/^View items \((\d+)\)$/, "आइटम देखें ($1)", "ଆଇଟମ୍ ଦେଖନ୍ତୁ ($1)"),
    P(/^Pay (.+) with UPI$/, "UPI से $1 भुगतान करें", "UPI ରେ $1 ଦେୟ ଦିଅନ୍ତୁ"),
    P(/^Bill #(.+)$/, "बिल #$1", "ବିଲ୍ #$1"),
    P(/^(.+) is no longer available and was removed from your order\.$/, "$1 अब उपलब्ध नहीं है और आपके ऑर्डर से हटा दिया गया।", "$1 ଆଉ ଉପଲବ୍ଧ ନାହିଁ ଏବଂ ଆପଣଙ୍କ ଅର୍ଡରରୁ ହଟାଯାଇଛି।"),
    P(/^No veg items available right now\.$/, "अभी कोई शाकाहारी आइटम उपलब्ध नहीं है।", "ବର୍ତ୍ତମାନ କୌଣସି ନିରାମିଷ ଆଇଟମ୍ ଉପଲବ୍ଧ ନାହିଁ।"),
    P(/^No non-veg items available right now\.$/, "अभी कोई मांसाहारी आइटम उपलब्ध नहीं है।", "ବର୍ତ୍ତମାନ କୌଣସି ଆମିଷ ଆଇଟମ୍ ଉପଲବ୍ଧ ନାହିଁ।"),
    P(/^No dishes found for “(.*)”.*Try another name\.$/, "“$1” के लिए कोई व्यंजन नहीं मिला। कोई और नाम आज़माएँ।", "“$1” ପାଇଁ କୌଣସି ଖାଦ୍ୟ ମିଳିଲା ନାହିଁ। ଅନ୍ୟ ନାମ ଚେଷ୍ଟା କରନ୍ତୁ।"),
    P(/^Live status isn't available right now, but your order has been sent\. Please ask a staff member for an update\.( \[.*\])?$/, "लाइव स्टेटस अभी उपलब्ध नहीं है, लेकिन आपका ऑर्डर भेज दिया गया है। कृपया अपडेट के लिए स्टाफ से पूछें।$1", "ଲାଇଭ୍ ଷ୍ଟାଟସ୍ ବର୍ତ୍ତମାନ ଉପଲବ୍ଧ ନାହିଁ, କିନ୍ତୁ ଆପଣଙ୍କ ଅର୍ଡର୍ ପଠାଯାଇଛି। ଦୟାକରି ଅପଡେଟ୍ ପାଇଁ ଷ୍ଟାଫ୍‌ଙ୍କୁ ପଚାରନ୍ତୁ।$1")
  ];

  /* Block-level sentences that contain markup / live elements. */
  var BLOCKS = [
    {
      sel: "#seatScreen > p", keep: ["seatScreenTableName"],
      hi: '<span id="seatScreenTableName">इस टेबल</span> पर बैठे अपने ग्रुप के सभी लोगों को चुनें, फिर <strong>पुष्टि करें</strong> दबाएँ।',
      or: '<span id="seatScreenTableName">ଏହି ଟେବୁଲ୍</span> ରେ ଥିବା ଆପଣଙ୍କ ଗୋଷ୍ଠୀର ସମସ୍ତଙ୍କୁ ବାଛନ୍ତୁ, ତା’ପରେ <strong>ନିଶ୍ଚିତ କରନ୍ତୁ</strong> ଦବାନ୍ତୁ।'
    },
    {
      sel: ".ord-co-en", keep: [],
      hi: 'जब आपको और कुछ ऑर्डर नहीं करना हो, तभी <b>चेकआउट</b> दबाएँ। चेकआउट करते ही यह डाइन-इन सेशन समाप्त हो जाएगा।',
      or: 'ଆଉ କିଛି ଅର୍ଡର୍ କରିବାକୁ ଚାହୁଁ ନଥିଲେ ହିଁ <b>ଚେକଆଉଟ୍</b> ଦବାନ୍ତୁ। ଚେକଆଉଟ୍ କଲେ ଏହି ଡାଇନ୍-ଇନ୍ ସେସନ୍ ଶେଷ ହୋଇଯିବ।'
    }
  ];

  /* ---------------------------------------------------------------
     2. DISH GLOSSARY — used only when the owner has NOT typed a
        Hindi / Odia name. A name is auto-translated only if EVERY
        word is known, so you never get half-English half-Hindi.
     --------------------------------------------------------------- */
  var G = {
    "paneer": ["पनीर", "ପନିର"], "chicken": ["चिकन", "ଚିକେନ୍"], "mutton": ["मटन", "ମଟନ୍"],
    "fish": ["मछली", "ମାଛ"], "prawn": ["झींगा", "ଚିଂଡ଼ି"], "prawns": ["झींगा", "ଚିଂଡ଼ି"],
    "egg": ["अंडा", "ଅଣ୍ଡା"], "veg": ["वेज", "ଭେଜ୍"], "mushroom": ["मशरूम", "ମଶରୁମ୍"],
    "aloo": ["आलू", "ଆଳୁ"], "gobi": ["गोभी", "ଫୁଲକୋବି"], "cheese": ["चीज़", "ଚିଜ୍"],
    "rice": ["चावल", "ଭାତ"], "fried rice": ["फ्राइड राइस", "ଫ୍ରାଇଡ୍ ରାଇସ୍"],
    "jeera rice": ["जीरा राइस", "ଜିରା ରାଇସ୍"], "steamed rice": ["स्टीम राइस", "ଷ୍ଟିମ୍ ରାଇସ୍"],
    "biryani": ["बिरयानी", "ବିରିୟାନି"], "pulao": ["पुलाव", "ପୁଲାଓ"], "khichdi": ["खिचड़ी", "ଖେଚୁଡ଼ି"],
    "dal": ["दाल", "ଡାଲି"], "dalma": ["दालमा", "ଡାଲମା"], "dal fry": ["दाल फ्राई", "ଡାଲି ଫ୍ରାଇ"],
    "dal tadka": ["दाल तड़का", "ଡାଲି ତଡ଼କା"],
    "roti": ["रोटी", "ରୋଟି"], "chapati": ["चपाती", "ଚପାତି"], "naan": ["नान", "ନାନ୍"],
    "paratha": ["पराठा", "ପରଟା"], "kulcha": ["कुलचा", "କୁଲଚା"], "puri": ["पूरी", "ପୁରି"],
    "dosa": ["डोसा", "ଡୋସା"], "idli": ["इडली", "ଇଡଲି"], "vada": ["वड़ा", "ବଡ଼ା"],
    "uttapam": ["उत्तपम", "ଉତ୍ତପମ୍"], "sambar": ["सांभर", "ସାମ୍ବାର"],
    "samosa": ["समोसा", "ସମୋସା"], "pakora": ["पकोड़ा", "ପକୋଡ଼ା"], "pakoda": ["पकोड़ा", "ପକୋଡ଼ା"],
    "sandwich": ["सैंडविच", "ସାଣ୍ଡୱିଚ୍"], "burger": ["बर्गर", "ବର୍ଗର"], "pizza": ["पिज़्ज़ा", "ପିଜ୍ଜା"],
    "pasta": ["पास्ता", "ପାସ୍ତା"], "noodles": ["नूडल्स", "ନୁଡୁଲ୍ସ"], "chowmein": ["चाउमीन", "ଚାଉମିନ୍"],
    "manchurian": ["मंचूरियन", "ମଞ୍ଚୁରିଆନ୍"], "momos": ["मोमोज़", "ମୋମୋ"], "roll": ["रोल", "ରୋଲ୍"],
    "rolls": ["रोल", "ରୋଲ୍"], "spring roll": ["स्प्रिंग रोल", "ସ୍ପ୍ରିଙ୍ ରୋଲ୍"],
    "soup": ["सूप", "ସୁପ୍"], "salad": ["सलाद", "ସଲାଡ୍"], "fries": ["फ्राइज़", "ଫ୍ରାଇଜ୍"],
    "french fries": ["फ्रेंच फ्राइज़", "ଫ୍ରେଞ୍ଚ ଫ୍ରାଇଜ୍"], "thali": ["थाली", "ଥାଳି"],
    "tikka": ["टिक्का", "ଟିକ୍କା"], "tandoori": ["तंदूरी", "ତନ୍ଦୁରୀ"], "kebab": ["कबाब", "କବାବ୍"],
    "masala": ["मसाला", "ମସଲା"], "butter": ["बटर", "ବଟର୍"], "curry": ["करी", "କରି"],
    "kadai": ["कड़ाही", "କଡ଼ାଇ"], "kadhai": ["कड़ाही", "କଡ଼ାଇ"], "kasa": ["कसा", "କଷା"], "kassa": ["कसा", "କଷା"],
    "chilli": ["चिली", "ଚିଲି"], "fried": ["फ्राइड", "ଫ୍ରାଇଡ୍"], "grilled": ["ग्रिल्ड", "ଗ୍ରିଲ୍ଡ"],
    "special": ["स्पेशल", "ସ୍ପେଶାଲ୍"], "garlic": ["लहसुन", "ରସୁଣ"], "plain": ["सादा", "ସାଦା"],
    "gulab jamun": ["गुलाब जामुन", "ଗୁଲାବ ଜାମୁନ୍"], "rasgulla": ["रसगुल्ला", "ରସଗୋଲା"],
    "rasmalai": ["रसमलाई", "ରସମଲାଇ"], "kheer": ["खीर", "ଖୀର"], "halwa": ["हलवा", "ହାଲୁଆ"],
    "ice cream": ["आइसक्रीम", "ଆଇସକ୍ରିମ୍"], "vanilla": ["वनीला", "ଭାନିଲା"], "chocolate": ["चॉकलेट", "ଚକଲେଟ୍"],
    "strawberry": ["स्ट्रॉबेरी", "ଷ୍ଟ୍ରବେରୀ"], "mango": ["आम", "ଆମ୍ବ"], "butterscotch": ["बटरस्कॉच", "ବଟରସ୍କଚ୍"],
    "cake": ["केक", "କେକ୍"], "pastry": ["पेस्ट्री", "ପେଷ୍ଟ୍ରି"], "brownie": ["ब्राउनी", "ବ୍ରାଉନି"],
    "tea": ["चाय", "ଚା"], "masala tea": ["मसाला चाय", "ମସଲା ଚା"], "coffee": ["कॉफ़ी", "କଫି"],
    "cold coffee": ["कोल्ड कॉफ़ी", "କୋଲ୍ଡ କଫି"], "lassi": ["लस्सी", "ଲସ୍ସି"], "juice": ["जूस", "ଜୁସ୍"],
    "soda": ["सोडा", "ସୋଡା"], "shake": ["शेक", "ସେକ୍"], "water": ["पानी", "ପାଣି"], "buttermilk": ["छाछ", "ଘୋଳ"],
    "pakhala": ["पखाल", "ପଖାଳ"], "chhena poda": ["छेना पोड़ा", "ଛେନାପୋଡ଼"], "dahi bara": ["दही बड़ा", "ଦହିବରା"],
    "dahibara": ["दही बड़ा", "ଦହିବରା"], "aloo dum": ["आलू दम", "ଆଳୁ ଦମ୍"], "ghuguni": ["घुगनी", "ଘୁଗୁନି"],
    "chuda": ["चूड़ा", "ଚୁଡ଼ା"], "rasabali": ["रसाबली", "ରସାବଳି"],
    /* sizes, counts, joiners */
    "small": ["छोटा", "ଛୋଟ"], "medium": ["मध्यम", "ମାଝାରି"], "large": ["बड़ा", "ବଡ଼"],
    "regular": ["रेगुलर", "ସାଧାରଣ"], "half": ["आधा", "ଅଧା"], "full": ["पूरा", "ପୂର୍ଣ୍ଣ"],
    "single": ["सिंगल", "ସିଙ୍ଗଲ୍"], "double": ["डबल", "ଡବଲ୍"], "extra": ["एक्स्ट्रा", "ଅତିରିକ୍ତ"],
    "pcs": ["पीस", "ପିସ୍"], "pc": ["पीस", "ପିସ୍"], "piece": ["पीस", "ପିସ୍"], "pieces": ["पीस", "ପିସ୍"],
    "and": ["और", "ଓ"], "&": ["और", "ଓ"]
  };

  /* ---------------------------------------------------------------
     3. STATE
     --------------------------------------------------------------- */
  var lang = "en";
  try { var saved = localStorage.getItem(KEY); if (saved === "hi" || saved === "or") lang = saved; } catch (e) {}

  var menuNames = { hi: {}, or: {} };   // English name -> translated name
  var menuSearch = {};                  // item id -> lowercase searchable text (all languages)
  var origText = new WeakMap();         // text node -> English text
  var shownText = new WeakMap();        // text node -> what we last wrote into it

  function hasLetters(s) { return /[A-Za-z\u0900-\u097F\u0B00-\u0B7F]/.test(s); }

  /* glossary lookup: every word must be known (digits pass through) */
  function autoName(name, l) {
    var i = IDX[l]; if (i === undefined || !name) return null;
    var words = String(name).toLowerCase().replace(/\s+/g, " ").trim().split(" ");
    var out = [], n = 0;
    while (n < words.length) {
      var hit = null, take = 0;
      for (var span = 3; span >= 1 && !hit; span--) {
        if (n + span > words.length) continue;
        var key = words.slice(n, n + span).join(" ");
        if (G[key]) { hit = G[key][i]; take = span; }
      }
      if (hit) { out.push(hit); n += take; }
      else if (/^\d+$/.test(words[n])) { out.push(words[n]); n++; }
      else return null;
    }
    return out.join(" ");
  }

  function setMenu(items) {
    menuNames = { hi: {}, or: {} };
    menuSearch = {};
    (items || []).forEach(function (it) {
      if (!it) return;
      var base = [String(it.name || "").toLowerCase(), String(it.name_hi || "").toLowerCase(), String(it.name_or || "").toLowerCase()];
      ["hi", "or"].forEach(function (l) {
        var manual = it["name_" + l];
        var t = (manual && String(manual).trim()) || autoName(it.name, l);
        if (t && it.name) menuNames[l][it.name] = t;
        if (t) base.push(String(t).toLowerCase());
        if (it.category) { var c = autoName(it.category, l); if (c && !UI[it.category]) menuNames[l][it.category] = c; }
        (it.variants || []).forEach(function (v) { var a = v && autoName(v.name, l); if (a && !UI[v.name]) menuNames[l][v.name] = a; });
        (it.addons || []).forEach(function (v) { var a = v && autoName(v.name, l); if (a && !UI[v.name]) menuNames[l][v.name] = a; });
      });
      menuSearch[it.id] = base.join(" ");
    });
    if (lang !== "en") applyAll();
  }

  /* one token of a dish line: UI word, menu name, or glossary */
  function lookup(tok, l) {
    var i = IDX[l];
    if (UI[tok]) return UI[tok][i];
    if (menuNames[l][tok]) return menuNames[l][tok];
    return autoName(tok, l);
  }

  /* "2× Paneer Tikka (Half) · + Extra Cheese" style lines */
  function composite(s, l) {
    var parts = s.split(/( · |, |\s\(|\)|\+ )/);
    var changed = false;
    var out = parts.map(function (p, k) {
      if (k % 2 === 1 || !p) return p;
      var m = /^(\d+)× (.+)$/.exec(p);
      if (m) { var t0 = lookup(m[2], l); if (t0) { changed = true; return m[1] + "× " + t0; } return p; }
      var t = lookup(p, l);
      if (t) { changed = true; return t; }
      return p;
    });
    return changed ? out.join("") : null;
  }

  function translateString(s, l) {
    var i = IDX[l]; if (i === undefined) return null;
    var lead = (/^\s*/.exec(s) || [""])[0], trail = (/\s*$/.exec(s) || [""])[0];
    var core = s.trim();
    if (!core || !hasLetters(core)) return null;
    var out = null;
    if (UI[core]) out = UI[core][i];
    else if (menuNames[l][core]) out = menuNames[l][core];
    if (out == null) {
      for (var k = 0; k < PATTERNS.length; k++) {
        var m = PATTERNS[k][0].exec(core);
        if (m) {
          out = PATTERNS[k][1][l].replace(/\$(\d)/g, function (_, d) {
            var raw = m[+d] || "";
            return composite(raw, l) || lookup(raw, l) || raw;
          });
          break;
        }
      }
    }
    if (out == null && core.length < 160) out = composite(core, l);
    return out == null ? null : lead + out + trail;
  }

  function tr(s) { var o = translateString(String(s), lang); return o == null ? String(s) : o; }

  /* ---------------------------------------------------------------
     4. DOM TRANSLATOR
     --------------------------------------------------------------- */
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  var attrOrig = new WeakMap();   // element -> {attr: english}
  var attrShown = new WeakMap();  // element -> {attr: shown}
  var busy = false;

  function skipNode(n) {
    for (var p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (SKIP[p.nodeName] || p.hasAttribute("data-no-i18n")) return true;
    }
    return false;
  }

  function doText(node) {
    var cur = node.nodeValue;
    var shown = shownText.get(node);
    if (shown !== undefined && shown === cur) {
      if (lang === "en") { var o = origText.get(node); if (o !== undefined) { node.nodeValue = o; shownText.delete(node); } }
      return;
    }
    origText.set(node, cur);            // app wrote fresh English text
    shownText.delete(node);
    if (lang === "en") return;
    var t = translateString(cur, lang);
    if (t != null && t !== cur) { shownText.set(node, t); node.nodeValue = t; }
  }

  function doAttrs(el) {
    if (!el.getAttribute) return;
    for (var a = 0; a < ATTRS.length; a++) {
      var name = ATTRS[a];
      if (!el.hasAttribute(name)) continue;
      var cur = el.getAttribute(name);
      var shownMap = attrShown.get(el) || {}, origMap = attrOrig.get(el) || {};
      if (shownMap[name] !== undefined && shownMap[name] === cur) {
        if (lang === "en") { el.setAttribute(name, origMap[name]); delete shownMap[name]; }
        continue;
      }
      origMap[name] = cur; attrOrig.set(el, origMap);
      delete shownMap[name]; attrShown.set(el, shownMap);
      if (lang === "en") continue;
      var t = translateString(cur, lang);
      if (t != null && t !== cur) { shownMap[name] = t; el.setAttribute(name, t); }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipNode(root)) doText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    doAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) { if (!skipNode(n)) doText(n); }
      else if (!SKIP[n.nodeName]) doAttrs(n);
    }
  }

  var blockOrig = {};
  function applyBlocks() {
    BLOCKS.forEach(function (b) {
      var el = document.querySelector(b.sel);
      if (!el) return;
      if (blockOrig[b.sel] === undefined) blockOrig[b.sel] = el.innerHTML;
      var html = lang === "en" ? blockOrig[b.sel] : b[lang];
      if (el.getAttribute("data-zi-lang") === lang) return;
      var keepText = {};
      b.keep.forEach(function (id) {
        var k = document.getElementById(id); if (!k) return;
        var nd = k.firstChild;
        keepText[id] = (nd && shownText.get(nd) === nd.nodeValue && origText.get(nd) !== undefined) ? origText.get(nd) : k.textContent;
      });
      el.innerHTML = html;
      el.setAttribute("data-zi-lang", lang);
      b.keep.forEach(function (id) {
        var k = document.getElementById(id);
        if (k && keepText[id] != null) k.textContent = keepText[id];
      });
    });
  }

  function applyAll() {
    busy = true;
    try { applyBlocks(); walk(document.body); }
    finally { busy = false; }
  }

  var obs = new MutationObserver(function (list) {
    if (busy) return;
    busy = true;
    try {
      list.forEach(function (m) {
        if (m.type === "characterData") { if (!skipNode(m.target)) doText(m.target); }
        else if (m.type === "attributes") { doAttrs(m.target); }
        else m.addedNodes.forEach(function (n) { walk(n); });
      });
    } finally { busy = false; }
  });

  /* ---------------------------------------------------------------
     5. SWITCHER BUTTONS (injected on every screen)
     --------------------------------------------------------------- */
  function makeSwitcher(extraClass) {
    var wrap = document.createElement("div");
    wrap.className = "zi-lang " + (extraClass || "");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language");
    wrap.setAttribute("data-no-i18n", "1");
    LANGS.forEach(function (L) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("data-zl", L[0]);
      b.textContent = L[1]; b.title = LANG_NAMES[L[0]];
      b.addEventListener("click", function (e) { e.stopPropagation(); setLang(L[0]); });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function syncSwitchers() {
    [].forEach.call(document.querySelectorAll(".zi-lang button"), function (b) {
      var on = b.getAttribute("data-zl") === lang;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function injectSwitchers() {
    var hero = document.querySelector(".ord-hero");
    if (hero && !hero.querySelector(".zi-lang")) hero.appendChild(makeSwitcher("zi-float"));
    ["seatScreen", "disabledScreen", "errorScreen"].forEach(function (id) {
      var s = document.getElementById(id);
      if (s && !s.querySelector(".zi-lang")) s.insertBefore(makeSwitcher("zi-fixed"), s.firstChild);
    });
    [].forEach.call(document.querySelectorAll(".ord-trk-top"), function (t) {
      if (!t.querySelector(".zi-lang")) t.appendChild(makeSwitcher("zi-inline"));
    });
    syncSwitchers();
  }

  function setLang(l) {
    if (l !== "en" && l !== "hi" && l !== "or") l = "en";
    lang = l;
    try { localStorage.setItem(KEY, l); } catch (e) {}
    document.documentElement.setAttribute("lang", l);
    document.documentElement.setAttribute("data-lang", l);
    applyAll();
    syncSwitchers();
  }

  /* ---------------------------------------------------------------
     6. PUBLIC API + START
     --------------------------------------------------------------- */
  window.ZI18N = {
    lang: function () { return lang; },
    setLang: setLang,
    setMenu: setMenu,
    t: tr,
    autoName: autoName,
    searchText: function (it) { return (it && menuSearch[it.id]) || ""; }
  };

  function start() {
    if (!document.querySelector(".ord-app, #seatScreen")) return;  // only on the customer page
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
    injectSwitchers();
    if (lang !== "en") applyAll();
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // screens that appear later (tracker / bill) get their switcher too
    new MutationObserver(function () { injectSwitchers(); }).observe(document.body, { childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();