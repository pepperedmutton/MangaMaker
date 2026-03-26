export type CuratedFontCategory =
  | "body_sans"
  | "body_serif"
  | "handwriting"
  | "display_heavy";

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
];

export const LOCAL_FONTS = CURATED_FONTS.map((font) => font.fontFamily);

export const DEFAULT_TEXT_FONT_FAMILY = LOCAL_FONTS[0];

export const isSupportedFontFamily = (fontFamily: string) =>
  LOCAL_FONTS.includes(fontFamily);
