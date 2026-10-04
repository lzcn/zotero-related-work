declare const SWSearch: typeof import("../src/search").SWSearch;
declare const SWPlugin: { id: string; version: string; rootURI: string };
declare const module: { exports: unknown };
declare const SWCorpus: typeof import("../src/corpus").SWCorpus;
declare const swYield: typeof import("../src/corpus").swYield;
declare const swPorterStem: typeof import("../src/stemmer").swPorterStem;
declare const SW_MAX_TOKENS: number;
declare const SWTokenizer: {
  termFreq: typeof import("../src/tokenizer").swTermFreq;
  tokenize: typeof import("../src/tokenizer").swTokenizeText;
  swFnv1a: typeof import("../src/tokenizer").swFnv1a;
  isStopword: typeof import("../src/tokenizer").swIsStopword;
};
declare namespace Zotero {
  const Fulltext: {
    isCachedMIMEType(mime: string): boolean;
    getItemCacheFile(item: Item): { path: string };
    queueItem(item: Item): Promise<void>;
  };
}

declare const APP_SHUTDOWN: number;

declare const SWSemantic: typeof import("../src/semantic").SWSemantic;
