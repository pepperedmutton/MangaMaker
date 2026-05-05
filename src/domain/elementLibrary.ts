import type { ElementCategory } from "./schema";

export type ElementLibraryItem = {
  id: string;
  title: string;
  category: ElementCategory;
  src: string;
  width: number;
  height: number;
  license: string;
  sourceName: string;
  sourceUrl: string;
};

export type ElementLibraryCategory = {
  id: ElementCategory;
  titleKey: string;
};

export const ELEMENT_LIBRARY_CATEGORIES: ElementLibraryCategory[] = [
  { id: "artWords", titleKey: "elements.category.artWords" },
  { id: "effects", titleKey: "elements.category.effects" },
  { id: "symbols", titleKey: "elements.category.symbols" },
  { id: "balloons", titleKey: "elements.category.balloons" },
  { id: "text", titleKey: "elements.category.text" },
];

export const ELEMENT_LIBRARY: ElementLibraryItem[] = [
  {
    id: "artwords-bam",
    title: "BAM!",
    category: "artWords",
    src: "/elements/artwords-bam.svg",
    width: 320,
    height: 220,
    license: "Public Domain",
    sourceName: "Publicdomainvectors / Openclipart",
    sourceUrl: "https://publicdomainvectors.org/en/free-clipart/Vintage-comic-BAM-sound-effect/35736.html",
  },
  {
    id: "artwords-pow",
    title: "POW!",
    category: "artWords",
    src: "/elements/artwords-pow.svg",
    width: 320,
    height: 220,
    license: "Public Domain",
    sourceName: "Publicdomainvectors / Openclipart",
    sourceUrl: "https://publicdomainvectors.org/en/free-clipart/Vintage-comic-POW-sound-effect/35735.html",
  },
  {
    id: "artwords-thwack",
    title: "THWACK!",
    category: "artWords",
    src: "/elements/artwords-thwack.svg",
    width: 340,
    height: 220,
    license: "Public Domain",
    sourceName: "Publicdomainvectors / Openclipart",
    sourceUrl: "https://publicdomainvectors.org/en/free-clipart/Vintage-comic-sound-effect/35737.html",
  },
  {
    id: "effects-zips-swooshes",
    title: "Motion Effects",
    category: "effects",
    src: "/elements/effects-zips-swooshes.svg",
    width: 260,
    height: 360,
    license: "Public Domain",
    sourceName: "Publicdomainvectors / Openclipart",
    sourceUrl: "https://publicdomainvectors.org/en/free-clipart/Cartoon-movement-effects/72196.html",
  },
  {
    id: "balloons-speech-cc0",
    title: "Speech Balloon",
    category: "balloons",
    src: "/elements/balloons-speech-cc0.svg",
    width: 300,
    height: 260,
    license: "CC0 1.0",
    sourceName: "Wikimedia Commons / Nevit Dilmen",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Speech_baloon.svg",
  },
  {
    id: "symbols-shattered-heart",
    title: "Shattered Heart",
    category: "symbols",
    src: "/elements/symbols-shattered-heart.svg",
    width: 180,
    height: 180,
    license: "CC BY 3.0",
    sourceName: "game-icons.net / Delapouite",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Shattered-heart_-_Delapouite_-_white_-_game-icons.svg",
  },
];

export const getElementLibraryItem = (id: string) =>
  ELEMENT_LIBRARY.find((item) => item.id === id) ?? null;
