/**
 * ═══════════════════════════════════════════════════════════════
 *  Calyptus Furniture — ملف الإعدادات الوحيد
 *  calyptusfurn.one
 * ═══════════════════════════════════════════════════════════════
 *
 *  كل محتوى الموقع من هنا. لا تحتاج لتعديل أي ملف آخر.
 *  This is the only file you need to edit to change the site.
 *
 *  ▸ لإضافة منتج:  انسخ أي كتلة من products وغيّر القيم
 *  ▸ لتغيير صورة:  ضع الصورة في assets/products/ بنفس الاسم
 *  ▸ لتغيير السعر: اكتبه في priceFrom (اتركه فارغاً = "تواصل للسعر")
 */

const CALYPTUS_CONFIG = {
  brand: {
    name: "Calyptus",
    nameAr: "كاليبتوس",
    tagline: "أثاث كلاسيكي فاخر",
    taglineEn: "Timeless Elegance",
    description:
      "قطع أثاث كلاسيكية تُصنع يداً في بغداد — خشب مُنتقى، تنجيد دقيق، وتفاصيل نحاسية أصيلة.",
    established: "EST. 2019",
    logo: "assets/logo.png",
    domain: "https://calyptusfurn.one",
    heroImage: "assets/products/hero.jpg",
  },

  whatsapp: {
    // بدون + وبدون مسافات — without + or spaces
    phone: "9647824316008",
    greeting: "السلام عليكم",
  },

  promo: {
    // اتركه فارغاً "" لإخفاء شريط الخصم — leave "" to hide the promo bar
    code: "CALYPTUS10",
    label: "خصم ١٠٪ عند ذكر الكود",
  },

  contact: {
    phoneDisplay: "+964 782 431 6008",
    address: "بغداد · حي المعرب · قرب شارع الأعظمية",
    addressShort: "بغداد، العراق",
    hours: "السبت — الخميس · ١٠:٠٠ ص — ٩:٠٠ م",
    mapsUrl: "https://maps.app.goo.gl/2oVfRbmL42x87Wzm6",
    lat: 33.36304,
    lng: 44.374528,
  },

  social: {
    // اترك أي رابط فارغاً "" ليختفي من الموقع
    instagram: "https://www.instagram.com/calyptus.iq",
    facebook: "https://www.facebook.com/share/1YUkRg2wjb/?mibextid=wwXIfr",
    whatsapp: "https://wa.me/9647824316008",
    tiktok: "https://www.tiktok.com/@calyptus.iq",
  },

  categories: [
    { id: "all", label: "الكل", labelEn: "All" },
    { id: "sofas", label: "أرائك", labelEn: "Sofas" },
    { id: "dining", label: "سفرة", labelEn: "Dining" },
    { id: "bedroom", label: "غرف نوم", labelEn: "Bedroom" },
    { id: "accent", label: "كراسي", labelEn: "Accent" },
    { id: "storage", label: "خزائن", labelEn: "Storage" },
  ],

  /**
   *  المنتجات — Products
   *
   *  code       رمز القطعة، يُرسل مع رسالة واتساب
   *  image      ضع الصورة في assets/products/ بنفس الاسم تماماً
   *  priceFrom  "من ٧٥٠ ألف" أو اتركه "" لعرض "تواصل للسعر"
   *  material   الخشب والقماش — يظهر تحت الاسم
   */
  products: [
    {
      code: "CL-001",
      category: "sofas",
      name: "أريكة تشسترفيلد الكلاسيكية",
      nameEn: "Chesterfield Classic",
      desc: "أريكة جلدية بلون الكراميل الدافئ، بأزرار مطرزة يدوياً ومسامير نحاسية.",
      material: "جلد طبيعي · خشب زان",
      priceFrom: "",
      image: "assets/products/cl-001.jpg",
      featured: true,
    },
    {
      code: "CL-002",
      category: "dining",
      name: "طقم سفرة ملكي",
      nameEn: "Royal Dining Suite",
      desc: "طاولة من خشب الجوز الفاخر مع ٦ كراسي مبطنة بقماش مخملي كريمي.",
      material: "خشب جوز · مخمل",
      priceFrom: "",
      image: "assets/products/cl-002.jpg",
    },
    {
      code: "CL-003",
      category: "bedroom",
      name: "سرير فرنسي فخم",
      nameEn: "Louis French Bed",
      desc: "سرير كينج بتاج منحوت يدوياً وظهر مبطن بأزرار كابتونيه، مع كومودينوين.",
      material: "خشب مُنحوت · تنجيد كابتونيه",
      priceFrom: "",
      image: "assets/products/cl-003.jpg",
      featured: true,
    },
    {
      code: "CL-004",
      category: "accent",
      name: "كرسي وينج مخملي",
      nameEn: "Emerald Wingback",
      desc: "كرسي مخملي زمردي بأرجل خشبية داكنة ونهايات نحاسية، مثالي لركن القراءة.",
      material: "مخمل · نحاس",
      priceFrom: "",
      image: "assets/products/cl-004.jpg",
    },
    {
      code: "CL-005",
      category: "storage",
      name: "كونسول فرنسي منحوت",
      nameEn: "Carved French Console",
      desc: "طاولة كونسول بنقوش يدوية دقيقة وأرجل مقوّسة، تُبرز فخامة المدخل.",
      material: "خشب مُنحوت يدوياً",
      priceFrom: "",
      image: "assets/products/cl-005.jpg",
    },
    {
      code: "CL-006",
      category: "storage",
      name: "دولاب كلاسيكي بمرايا",
      nameEn: "Mirrored Wardrobe",
      desc: "دولاب واسع بثلاث أبواب من المرايا وتاج منحوت، بلمسات نحاسية أصيلة.",
      material: "خشب · مرايا · نحاس",
      priceFrom: "",
      image: "assets/products/cl-006.jpg",
    },
  ],

  features: [
    {
      title: "صناعة يدوية",
      titleEn: "Handcrafted",
      text: "كل قطعة تُصنع في ورشتنا — لا خطوط إنتاج ولا استيراد جاهز.",
    },
    {
      title: "تفصيل حسب الطلب",
      titleEn: "Made to Order",
      text: "اختر الخشب والقماش والمقاس. نُنفّذ القطعة كما تريدها تماماً.",
    },
    {
      title: "توصيل وتركيب",
      titleEn: "Delivery & Setup",
      text: "نوصل ونركّب داخل بغداد، ونشحن إلى باقي المحافظات.",
    },
  ],

  gallery: [
    { image: "assets/products/atelier-1.jpg", alt: "من داخل الورشة" },
    { image: "assets/products/atelier-2.jpg", alt: "تفاصيل التنجيد" },
    { image: "assets/products/atelier-3.jpg", alt: "المعرض في بغداد" },
  ],
};
