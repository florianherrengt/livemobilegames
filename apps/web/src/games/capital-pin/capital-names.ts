/**
 * French forms for the game's capital list, from the CNT/CNIG reference:
 * https://cnig.gouv.fr/IMG/pdf/liste_pays_territoires_et_villes_du_monde_fev_2025.pdf
 */
const FRENCH_CAPITAL_NAMES: Readonly<Record<string, string>> = {
  London: "Londres",
  Brussels: "Bruxelles",
  Vienna: "Vienne",
  Lisbon: "Lisbonne",
  Warsaw: "Varsovie",
  Bucharest: "Bucarest",
  Athens: "Athènes",
  Copenhagen: "Copenhague",
  Kyiv: "Kiev",
  "Andorra la Vella": "Andorre-la-Vieille",
  "San Marino": "Saint-Marin",
  "Vatican City": "Vatican",
  Moscow: "Moscou",
  Valletta: "La Valette",
  Cairo: "Le Caire",
  Algiers: "Alger",
  "Addis Ababa": "Addis Abeba",
  Yaounde: "Yaoundé",
  Lome: "Lomé",
  "N'Djamena": "Ndjamena",
  "Port Louis": "Port-Louis",
  Beijing: "Pékin",
  Seoul: "Séoul",
  Hanoi: "Hanoï",
  Dhaka: "Dacca",
  Kabul: "Kaboul",
  Kathmandu: "Katmandou",
  Thimphu: "Thimphou",
  Male: "Malé",
  Ulaanbaatar: "Oulan-Bator",
  Bishkek: "Bichkek",
  Dushanbe: "Douchanbé",
  Tashkent: "Tachkent",
  Ashgabat: "Achgabat",
  Tehran: "Téhéran",
  Baghdad: "Bagdad",
  Damascus: "Damas",
  Beirut: "Beyrouth",
  Riyadh: "Riyad",
  "Kuwait City": "Koweït",
  "Abu Dhabi": "Abou Dhabi",
  Muscat: "Mascate",
  Jerusalem: "Jérusalem",
  Manila: "Manille",
  Singapore: "Singapour",
  "Washington, D.C.": "Washington",
  "Mexico City": "Mexico",
  "Guatemala City": "Guatémala",
  "San Jose": "San José",
  "Panama City": "Panama",
  Havana: "La Havane",
  "Santo Domingo": "Saint-Domingue",
  Asuncion: "Assomption",
  Antananarivo: "Tananarive",
  "Sri Jayawardenepura Kotte": "Sri Jayewardenepura-Kotte",
  Taipei: "Taïpei",
  "Port Vila": "Port-Vila",
  "South Tarawa": "Tarawa-Sud",
};

/**
 * Return the French display form for a known capital when the browser's
 * primary language is French. Unknown names and other locales stay as-is.
 */
export function getCapitalCityDisplayName(
  cityName: string,
  language: string = navigator.language,
): string {
  if (!/^fr(?:-|$)/i.test(language)) {
    return cityName;
  }
  return FRENCH_CAPITAL_NAMES[cityName] ?? cityName;
}
