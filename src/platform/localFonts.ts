export type CuratedFontCategory =
  | "body_sans"
  | "body_serif"
  | "handwriting"
  | "display_heavy"
  | "manga_japanese"
  | "manga_latin";

export type CuratedFont = {
  nameCn: string;
  fontFamily: string;
  category: CuratedFontCategory;
  license: string;
  tags: string[];
};

export const CURATED_FONTS: CuratedFont[] = [
  {
    nameCn: "\u601d\u6e90\u9ed1\u4f53",
    fontFamily: "Source Han Sans",
    category: "body_sans",
    license: "OFL 1.1",
    tags: ["\u6b63\u6587", "\u5bf9\u8bdd", "\u73b0\u4ee3", "\u9ad8\u8fa8\u8bc6\u5ea6"],
  },
  {
    nameCn: "\u601d\u6e90\u5b8b\u4f53",
    fontFamily: "Source Han Serif",
    category: "body_serif",
    license: "OFL 1.1",
    tags: ["\u6b63\u6587", "\u65c1\u767d", "\u53e4\u5178", "\u9ad8\u53ef\u8bfb\u6027"],
  },
  {
    nameCn: "\u971e\u9e5c\u6587\u6977",
    fontFamily: "LXGW WenKai",
    category: "body_serif",
    license: "OFL 1.1",
    tags: ["\u6b63\u6587", "\u72ec\u767d", "\u4eff\u53e4\u7c4d", "\u6587\u827a"],
  },
  {
    nameCn: "\u65b9\u6b63\u4eff\u5b8b_GBK (\u514d\u8d39\u5546\u7528\u7248)",
    fontFamily: "FZFangSong-Z02",
    category: "body_serif",
    license: "Freeware (Commercial allowed by FounderType)",
    tags: ["\u56de\u5fc6", "\u65c1\u767d", "\u4f20\u7edf"],
  },
  {
    nameCn: "\u6768\u4efb\u4e1c\u7af9\u77f3\u4f53",
    fontFamily: "YRDZST",
    category: "handwriting",
    license: "OFL 1.1",
    tags: ["\u65c1\u767d", "\u786c\u6717\u624b\u5199", "\u60c5\u7eea\u5316"],
  },
  {
    nameCn: "\u5e9e\u95e8\u6b63\u9053\u6807\u9898\u4f53",
    fontFamily: "PangMenZhengDao",
    category: "display_heavy",
    license: "Freeware (Commercial allowed)",
    tags: ["\u7edd\u62db", "\u7206\u70b8\u97f3\u6548", "\u529b\u91cf\u611f"],
  },
  {
    nameCn: "\u7ad9\u9177\u9177\u9ed1",
    fontFamily: "ZCOOL KuHei",
    category: "display_heavy",
    license: "Freeware (Commercial allowed by ZCOOL)",
    tags: ["\u673a\u68b0\u97f3\u6548", "\u79d1\u5e7b", "\u91cd\u5de5\u4e1a"],
  },
  {
    nameCn: "\u6c90\u7476\u968f\u5fc3\u624b\u5199\u4f53",
    fontFamily: "Muyao-Softbrush",
    category: "handwriting",
    license: "Freeware",
    tags: ["\u5410\u69fd", "Q\u7248", "\u65e5\u8bb0\u624b\u5199"],
  },
  {
    nameCn: "Yomogi \u65e5\u6587\u624b\u5199\u4f53",
    fontFamily: "Yomogi",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u624b\u5199", "\u72ec\u767d", "\u6cbb\u6108"],
  },
  {
    nameCn: "Hachi Maru Pop \u6ce1\u6ce1\u624b\u5199\u4f53",
    fontFamily: "Hachi Maru Pop",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u53ef\u7231", "\u5410\u69fd", "\u6c14\u6ce1\u5b57"],
  },
  {
    nameCn: "Dela Gothic One \u65e5\u6587\u9ed1\u4f53\u6807\u9898",
    fontFamily: "Dela Gothic One",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u6807\u9898", "\u62df\u58f0\u8bcd", "\u91cd\u91cf\u611f"],
  },
  {
    nameCn: "Reggae One \u5f8b\u52a8\u65e5\u6587\u4f53",
    fontFamily: "Reggae One",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u5938\u5f20", "\u559c\u5267", "\u89d2\u8272\u53f0\u8bcd"],
  },
  {
    nameCn: "Rampart One \u65e5\u6587\u7acb\u4f53\u8f6e\u5ed3",
    fontFamily: "Rampart One",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u8f6e\u5ed3", "\u6807\u9898", "\u62df\u58f0\u8bcd"],
  },
  {
    nameCn: "DotGothic16 \u70b9\u9635\u65e5\u6587\u4f53",
    fontFamily: "DotGothic16",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u70b9\u9635", "\u7535\u5b50", "\u590d\u53e4"],
  },
  {
    nameCn: "Stick \u65e5\u6587\u7b49\u7ebf\u624b\u5199",
    fontFamily: "Stick",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u624b\u5199", "\u6807\u9898", "\u6e05\u6670"],
  },
  {
    nameCn: "Kaisei Decol \u88c5\u9970\u660e\u671d\u4f53",
    fontFamily: "Kaisei Decol",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u660e\u671d", "\u65c1\u767d", "\u620f\u5267"],
  },
  {
    nameCn: "Kiwi Maru \u5706\u4f53\u65e5\u6587",
    fontFamily: "Kiwi Maru",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u5706\u4f53", "\u5bf9\u8bdd", "\u67d4\u548c"],
  },
  {
    nameCn: "Yuji Boku \u6bdb\u7b14\u65e5\u6587",
    fontFamily: "Yuji Boku",
    category: "manga_japanese",
    license: "OFL 1.1",
    tags: ["\u65e5\u8bed", "\u6bdb\u7b14", "\u53e4\u98ce", "\u65c1\u767d"],
  },
  {
    nameCn: "Bangers \u7f8e\u5f0f\u6f2b\u753b\u6807\u9898",
    fontFamily: "Bangers",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "comic", "title", "action"],
  },
  {
    nameCn: "Luckiest Guy \u5361\u901a\u6807\u9898",
    fontFamily: "Luckiest Guy",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "comic", "bold", "poster"],
  },
  {
    nameCn: "Comic Neue \u5bf9\u767d\u624b\u5199\u4f53",
    fontFamily: "Comic Neue",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "dialogue", "handwriting", "clean"],
  },
  {
    nameCn: "Permanent Marker \u9a6c\u514b\u7b14\u4f53",
    fontFamily: "Permanent Marker",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "marker", "shout", "rough"],
  },
  {
    nameCn: "Chewy \u6ce1\u6ce1\u5361\u901a\u4f53",
    fontFamily: "Chewy",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "comic", "bubble", "cute"],
  },
  {
    nameCn: "Bubblegum Sans \u6c14\u6ce1\u82f1\u6587\u4f53",
    fontFamily: "Bubblegum Sans",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "comic", "bubble", "dialogue"],
  },
  {
    nameCn: "Boogaloo \u590d\u53e4\u6f2b\u753b\u4f53",
    fontFamily: "Boogaloo",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "retro", "comic", "title"],
  },
  {
    nameCn: "Carter One \u7c97\u91cd\u6807\u9898\u4f53",
    fontFamily: "Carter One",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "bold", "display", "sound effect"],
  },
  {
    nameCn: "Creepster \u60ca\u609a\u6f2b\u753b\u4f53",
    fontFamily: "Creepster",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "horror", "monster", "effect"],
  },
  {
    nameCn: "Freckle Face \u7ae5\u8da3\u6f2b\u753b\u4f53",
    fontFamily: "Freckle Face",
    category: "manga_latin",
    license: "OFL 1.1",
    tags: ["English", "comic", "kids", "handwriting"],
  },
];

export const LOCAL_FONTS = CURATED_FONTS.map((font) => font.fontFamily);

export const DEFAULT_TEXT_FONT_FAMILY = LOCAL_FONTS[0];

export const isSupportedFontFamily = (fontFamily: string) =>
  LOCAL_FONTS.includes(fontFamily);
