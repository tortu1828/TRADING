const DOLAR_COLOMBIA_URL = "https://www.dolar-colombia.com/";

function normalizeHtmlToText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&aacute;|&#225;/gi, "á")
    .replace(/&eacute;|&#233;/gi, "é")
    .replace(/&iacute;|&#237;/gi, "í")
    .replace(/&oacute;|&#243;/gi, "ó")
    .replace(/&uacute;|&#250;/gi, "ú")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRateToken(token) {
  const clean = String(token || "").replace(/,/g, "");

  if (!/^\d{4,5}\.\d{2}$/.test(clean)) {
    throw new Error("DOLAR_COLOMBIA_INVALID_RATE_FORMAT");
  }

  const rate = Number(clean);

  if (!Number.isFinite(rate) || rate < 1000 || rate > 10000) {
    throw new Error("DOLAR_COLOMBIA_RATE_OUT_OF_RANGE");
  }

  const rateCents = Math.round(rate * 100);

  return {
    rate: rateCents / 100,
    rateCents,
  };
}

function parseEffectiveDate(text) {
  const months = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    setiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };

  const match = text.match(
    /TRM\s+vigente\s+al\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)?\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:del|de)\s+(\d{4})/i
  );

  if (!match) {
    throw new Error("DOLAR_COLOMBIA_EFFECTIVE_DATE_NOT_FOUND");
  }

  const day = String(Number(match[1])).padStart(2, "0");
  const monthName = match[2]
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const month = months[monthName];

  if (!month) {
    throw new Error("DOLAR_COLOMBIA_INVALID_MONTH");
  }

  return `${match[3]}-${month}-${day}`;
}

function parseDolarColombiaHtml(html) {
  const text = normalizeHtmlToText(html);

  const mainMatch = text.match(
    /1\s*USD\s*=\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*COP/i
  );

  if (!mainMatch) {
    throw new Error("DOLAR_COLOMBIA_MAIN_RATE_NOT_FOUND");
  }

  const conversionMatch = text.match(
    /1\.00\s*D[oó]lares\s*(?:\||=|\s)+\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*Pesos/i
  );

  if (!conversionMatch) {
    throw new Error("DOLAR_COLOMBIA_CONVERSION_RATE_NOT_FOUND");
  }

  const main = parseRateToken(mainMatch[1]);
  const conversion = parseRateToken(conversionMatch[1]);

  if (main.rateCents !== conversion.rateCents) {
    throw new Error(
      `DOLAR_COLOMBIA_RATE_MISMATCH:${main.rate}:${conversion.rate}`
    );
  }

  const effectiveDate = parseEffectiveDate(text);

  const formattedToken = mainMatch[1];
  const occurrences =
    text.split(formattedToken).length - 1;

  if (occurrences < 2) {
    throw new Error(
      "DOLAR_COLOMBIA_RATE_NOT_REDUNDANT"
    );
  }

  return {
    rate: main.rate,
    rateCents: main.rateCents,
    effectiveDate,
    source: "DOLAR_COLOMBIA",
    sourceLabel: "Dolar-Colombia.com",
    sourceUrl: DOLAR_COLOMBIA_URL,
    validations: {
      mainRate: main.rate,
      conversionRate: conversion.rate,
      matchingOccurrences: occurrences,
    },
  };
}

async function fetchDolarColombiaTrm() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    8000
  );

  try {
    const response = await fetch(
      DOLAR_COLOMBIA_URL,
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "EasyTraders-TRM/1.0 (+https://easytraders24.app)",
          "Accept":
            "text/html,application/xhtml+xml",
          "Cache-Control":
            "no-cache",
          "Pragma":
            "no-cache",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `DOLAR_COLOMBIA_HTTP_${response.status}`
      );
    }

    const html = await response.text();

    const parsed =
      parseDolarColombiaHtml(html);

    return {
      ...parsed,
      capturedAt:
        new Date().toISOString(),
      isLive: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DOLAR_COLOMBIA_URL,
  parseDolarColombiaHtml,
  fetchDolarColombiaTrm,
};
