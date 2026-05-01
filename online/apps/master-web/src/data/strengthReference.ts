/**
 * Referencia de strengths para el master (menú lateral).
 * Listados alineados a las planillas SXS (Strengths I / II) provistas en PDF.
 */

export type StrengthReferenceEntry = {
  /** Clave estable para listas / persistencia futura */
  key: string;
  /** Nombre mostrado (inglés, como en la hoja) */
  name: string;
  /** Explicación para el maestro/jugadores */
  descriptionEs: string;
};

/** Planilla 1 SXS — Strengths I (orden del PDF; incluye progresión TI/SI/MI). */
export const STRENGTHS_I_REFERENCE: StrengthReferenceEntry[] = [
  {
    key: "cool_under_pressure",
    name: "Cool Under Pressure",
    descriptionEs:
      "Podés gastar 1 ficha de adversidad para usar la mitad del valor de tu dado en lugar de tirar en una decisión instantánea (Snap Decision).",
  },
  {
    key: "gross",
    name: "Gross",
    descriptionEs:
      "Tenés un truco corporal bastante asqueroso (ruidoso, silencioso, oloroso, etc.: vos elegís) que podés hacer a voluntad.",
  },
  {
    key: "prepared",
    name: "Prepared",
    descriptionEs:
      "Podés gastar 2 fichas de adversidad para que, por casualidad, tengas un objeto cotidiano encima (a criterio del director).",
  },
  {
    key: "rebellious",
    name: "Rebellious",
    descriptionEs:
      "Sumás +1 a las tiradas al persuadir o resistir persuasión de niños. Sumás +1 a las tiradas al resistir persuasión de adultos.",
  },
  {
    key: "tough",
    name: "Tough",
    descriptionEs:
      "Si perdés una tirada de combate, sumás +3 al resultado negativo. Igual perdés la tirada, pero podés reducir la pérdida hasta −1.",
  },
  {
    key: "treasure_hunter",
    name: "Treasure Hunter",
    descriptionEs:
      "Podés gastar 1 ficha de adversidad para encontrar un objeto útil en el entorno cercano.",
  },
  {
    key: "unassuming",
    name: "Unassuming",
    descriptionEs:
      "Podés gastar 2 fichas de adversidad para pasar inadvertido dentro de lo razonable (a criterio del director).",
  },
  {
    key: "wealthy",
    name: "Wealthy",
    descriptionEs:
      "Podés gastar dinero como si fueras de un tramo etario mayor. Ej.: un niño rico cuenta con ingreso disponible típico de un adolescente; un adolescente rico, el de un adulto; un adulto rico casi no tiene que preocuparse por la plata: puede comprar lo que necesite y usar el dinero para salir de muchos apuros.",
  },
  {
    key: "quick_healing",
    name: "Quick Healing",
    descriptionEs:
      "Te recuperás más rápido de las lesiones y no sufrís efectos persistentes por la mayoría de ellas.",
  },
  {
    key: "innocence",
    name: "Innocence",
    descriptionEs:
      "Una vez por sesión, a criterio del director, podés gastar 2 fichas de adversidad para convencer a un adulto de que no te castigue por una transgresión menor.",
  },
  {
    key: "trained_in",
    name: "Trained in...",
    descriptionEs:
      "Elegí una estadística: obtenés +1 a todas las tiradas de ese tipo.",
  },
  {
    key: "studied_in",
    name: "Studied in...",
    descriptionEs:
      "Elegí una estadística en la que ya seas Trained in: obtenés +3 a todas las tiradas/hechizos de ese tipo (no suma con el bonus de «Trained in...»).",
  },
  {
    key: "master_of",
    name: "Master of...",
    descriptionEs:
      "Elegí una estadística en la que ya seas Studied in: obtenés +5 en ese tipo (no suma con «Trained in...» ni «Studied in...»).",
  },
  {
    key: "wild_speak",
    name: "Wild Speak",
    descriptionEs:
      "Podés comunicarte con un tipo de animal cuya especie conozcas.",
  },
];

/** Planilla 2 SXS — Strengths II (orden del PDF). */
export const STRENGTHS_II_REFERENCE: StrengthReferenceEntry[] = [
  {
    key: "heroic",
    name: "Heroic",
    descriptionEs:
      "No necesitás permiso del director para gastar fichas de adversidad e ignorar miedos (Fears).",
  },
  {
    key: "intuitive",
    name: "Intuitive",
    descriptionEs:
      "Podés gastar 1 ficha de adversidad para preguntarle al director por el entorno, un PNJ u otro tema similar; debe responder con honestidad.",
  },
  {
    key: "lucky",
    name: "Lucky",
    descriptionEs:
      "Podés gastar 2 fichas de adversidad para volver a tirar una tirada de estadística una vez por escena.",
  },
  {
    key: "by_the_book",
    name: "By the Book",
    descriptionEs:
      "Restás 3 a la DC de una tirada de Charm cuando interactuás con figuras de autoridad.",
  },
  {
    key: "poker_face",
    name: "Poker Face",
    descriptionEs:
      "Al intentar ocultar la verdad, usás Grit en lugar de Charm.",
  },
  {
    key: "protector",
    name: "Protector",
    descriptionEs:
      "Restás 3 a la DC de una tirada cuando defendés a tus amigos.",
  },
  {
    key: "duelist",
    name: "Duelist",
    descriptionEs:
      "Restás 3 a la DC de una tirada de Weapons (armas/pelea con armas) contra alguien que empuña la misma arma que vos.",
  },
  {
    key: "stealthy",
    name: "Stealthy",
    descriptionEs:
      "Restás 3 a la DC de una tirada de Flight cuando intentás pasar desapercibido.",
  },
  {
    key: "inspiring",
    name: "Inspiring",
    descriptionEs:
      "Motivás a otros en momentos críticos: encaja duelos donde el efecto sobre el equipo o la moral marca la escena.",
  },
  {
    key: "suspicious",
    name: "Suspicious",
    descriptionEs:
      "Restás 3 a la DC de una tirada de Brains cuando intentás saber si alguien te miente.",
  },
  {
    key: "martial_artist",
    name: "Martial Artist",
    descriptionEs:
      "Gastá un Turbo Token para que un enemigo resista tu Brawl usando Brains en lugar de Brawn.",
  },
  {
    key: "help",
    name: "Help",
    descriptionEs:
      "Podés gastar 2 fichas para dar +1 en una tirada a un amigo.",
  },
];
