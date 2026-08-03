/**
 * إعدادات موقع Calyptus — calyptusfurn.one
 */
const CALYPTUS_CONFIG = {
  brand: {
    name: "Calyptus",
    tagline: "أثاث يعكس ذوقك",
    description:
      "نصنع مساحات تعيش فيها — تصاميم أثاث عصرية وكلاسيكية بجودة استثنائية، من غرف المعيشة إلى غرف النوم والمكاتب.",
    logo: "assets/logo.png",
    domain: "https://calyptusfurn.one",
    heroImage:
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1200&q=85",
  },

  whatsapp: {
    phone: "9647824316008",
    defaultMessage: "مرحباً Calyptus، أود الاستفسار عن منتجاتكم.",
  },

  promo: {
    code: "CALYPTUS10",
    agentName: "فريق Calyptus",
  },

  social: {
    instagram:
      "https://www.instagram.com/calyptus.iq?igsh=Mnk3cGFuN2RiYzJm&utm_source=qr",
    facebook:
      "https://www.facebook.com/share/1YUkRg2wjb/?mibextid=wwXIfr",
    whatsapp: "https://wa.me/9647824316008",
    tiktok: "",
  },

  features: [
    {
      icon: "✦",
      title: "جودة فاخرة",
      text: "مواد مختارة وتشطيبات دقيقة في كل قطعة",
    },
    {
      icon: "◈",
      title: "تصاميم حصرية",
      text: "مجموعات عصرية وكلاسيكية تناسب كل ذوق",
    },
    {
      icon: "◎",
      title: "توصيل وتركيب",
      text: "خدمة متكاملة من الطلب حتى باب منزلك",
    },
  ],

  products: [
    {
      id: "sofa-lux",
      name: "كنبة فاخرة",
      category: "living",
      categoryLabel: "غرف المعيشة",
      image:
        "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=900&q=85",
      price: "تواصل للسعر",
      featured: true,
    },
    {
      id: "bed-modern",
      name: "سرير عصري",
      category: "bedroom",
      categoryLabel: "غرف النوم",
      image:
        "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=900&q=85",
      price: "تواصل للسعر",
    },
    {
      id: "dining-set",
      name: "طقم طعام خشبي",
      category: "dining",
      categoryLabel: "غرف الطعام",
      image:
        "https://images.unsplash.com/photo-1617806118233-18e1de247200?w=900&q=85",
      price: "تواصل للسعر",
    },
    {
      id: "office-desk",
      name: "مكتب تنفيذي",
      category: "office",
      categoryLabel: "المكاتب",
      image:
        "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=900&q=85",
      price: "تواصل للسعر",
    },
    {
      id: "wardrobe",
      name: "خزانة ملابس",
      category: "bedroom",
      categoryLabel: "غرف النوم",
      image:
        "https://images.unsplash.com/photo-1595428774223-ef52624120b2?w=900&q=85",
      price: "تواصل للسعر",
    },
    {
      id: "coffee-table",
      name: "طاولة قهوة",
      category: "living",
      categoryLabel: "غرف المعيشة",
      image:
        "https://images.unsplash.com/photo-1532372320572-cda25653a26d?w=900&q=85",
      price: "تواصل للسعر",
    },
  ],

  categories: [
    { id: "all", label: "الكل" },
    { id: "living", label: "غرف المعيشة" },
    { id: "bedroom", label: "غرف النوم" },
    { id: "dining", label: "غرف الطعام" },
    { id: "office", label: "المكاتب" },
  ],

  contact: {
    phone: "+964 782 431 6008",
    email: "hello@calyptusfurn.one",
    city: "العراق",
  },
};
