export interface JSONSchema {
    chart: Chart;
}

export interface Chart {
    result: Result[];
    error:  null;
}

export interface Result {
    meta:       Meta;
    timestamp:  number[];
    indicators: Indicators;
}

export interface Indicators {
    quote:    Quote[];
    adjclose: Adjclose[];
}

export interface Adjclose {
    adjclose: number[];
}

export interface Quote {
    low:    number[];
    close:  number[];
    open:   number[];
    high:   number[];
    volume: number[];
}

export interface Meta {
    currency:             string;
    symbol:               string;
    exchangeName:         string;
    fullExchangeName:     string;
    instrumentType:       string;
    firstTradeDate:       number;
    regularMarketTime:    number;
    hasPrePostMarketData: boolean;
    gmtoffset:            number;
    timezone:             string;
    exchangeTimezoneName: string;
    regularMarketPrice:   number;
    fiftyTwoWeekHigh:     number;
    fiftyTwoWeekLow:      number;
    regularMarketDayHigh: number;
    regularMarketDayLow:  number;
    regularMarketVolume:  number;
    longName:             string;
    shortName:            string;
    chartPreviousClose:   number;
    priceHint:            number;
    currentTradingPeriod: CurrentTradingPeriod;
    dataGranularity:      string;
    range:                string;
    validRanges:          string[];
}

export interface CurrentTradingPeriod {
    pre:     Post;
    regular: Post;
    post:    Post;
}

export interface Post {
    timezone:  string;
    end:       number;
    start:     number;
    gmtoffset: number;
}
