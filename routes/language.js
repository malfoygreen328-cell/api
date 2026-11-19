import express from "express";

const router = express.Router();

/* ===========================
TRANSLATIONS
=========================== */

const translations = {

  en: {
    greeting: "Hello",
    searchPlaceholder: "Search products",
    male: "Male",
    female: "Female",
    newArrivals: "New Arrivals",
    accessories: "Accessories",
    category: "Category",
    price: "Price",
    addToCart: "Add to Cart",
    loadingProducts: "Loading products...",
    noProducts: "No products found",
    failedLoad: "Failed to load products"
  },

  zu: {
    greeting: "Sawubona",
    searchPlaceholder: "Sesha imikhiqizo",
    male: "Abesilisa",
    female: "Abesifazane",
    newArrivals: "Okusha",
    accessories: "Izinsiza",
    category: "Isigaba",
    price: "Intengo",
    addToCart: "Faka enqoleni",
    loadingProducts: "Kulayishwa imikhiqizo...",
    noProducts: "Ayikho imikhiqizo etholakele",
    failedLoad: "Ukulayisha kuhlulekile"
  },

  st: {
    greeting: "Lumela",
    searchPlaceholder: "Batla lihlahisoa",
    male: "Banna",
    female: "Basali",
    newArrivals: "Lihlahisoa tse Ncha",
    accessories: "Lisebelisoa",
    category: "Sehlopha",
    price: "Theko",
    addToCart: "Kenya koloing",
    loadingProducts: "Ho kenya lihlahisoa...",
    noProducts: "Ha ho lihlahisoa tse fumanoeng",
    failedLoad: "Ho kenya ho hlolehile"
  },

  tn: {
    greeting: "Dumela",
    searchPlaceholder: "Batla dithoto",
    male: "Banna",
    female: "Basadi",
    newArrivals: "Dithoto Tse Ntsha",
    accessories: "Didirisiwa",
    category: "Setlhopha",
    price: "Tlhwatlhwa",
    addToCart: "Tsenya mo kariking",
    loadingProducts: "Go laisa dithoto...",
    noProducts: "Ga go na dithoto",
    failedLoad: "Go laisa go paletswe"
  },

  ve: {
    greeting: "Ndaa",
    searchPlaceholder: "Toda zwibveledzwa",
    male: "Vhanna",
    female: "Vhasadzi",
    newArrivals: "Zwiswa Zwiswa",
    accessories: "Zwishumiswa",
    category: "Tshigwada",
    price: "Mutengo",
    addToCart: "Engedza kha kariki",
    loadingProducts: "U laisa zwibveledzwa...",
    noProducts: "A huna zwibveledzwa",
    failedLoad: "U laisa zwo kundelwa"
  },

  nso: {
    greeting: "Dumela",
    searchPlaceholder: "Nyaka dithoto",
    male: "Banna",
    female: "Basadi",
    newArrivals: "Dithoto Tša Mafsa",
    accessories: "Didirišwa",
    category: "Sehlopha",
    price: "Theko",
    addToCart: "Tsenya ka kariking",
    loadingProducts: "Go laisa dithoto...",
    noProducts: "Ga go na dithoto",
    failedLoad: "Go laisa go paletšwe"
  }

};

/* ===========================
GET LANGUAGE TRANSLATION
=========================== */

router.get("/:lang", (req, res) => {

  const lang = req.params.lang.toLowerCase();

  const data = translations[lang] || translations.en;

  res.status(200).json({
    success: true,
    language: lang,
    data
  });

});

/* ===========================
AVAILABLE LANGUAGES
=========================== */

router.get("/", (req, res) => {

  res.status(200).json({
    success: true,
    languages: Object.keys(translations)
  });

});

export default router;