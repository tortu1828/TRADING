import {
  describe,
  expect,
  it,
} from 'vitest';

import fs from 'node:fs';

const indexSource =
  fs.readFileSync(
    'functions/index.js',
    'utf8'
  );

const firestoreSource =
  fs.readFileSync(
    'src/lib/firestoreService.ts',
    'utf8'
  );

const storeSource =
  fs.readFileSync(
    'src/lib/dataStore.ts',
    'utf8'
  );

const trmServiceSource =
  fs.readFileSync(
    'src/lib/trmService.ts',
    'utf8'
  );

describe(
  'Dolar-Colombia server authority',
  () => {

    it(
      'owns daily operations',
      () => {
        expect(
          indexSource
        ).toContain(
          'DOLAR_COLOMBIA_SERVER_AUTHORITY'
        );
      }
    );


    it(
      'owns TRM updates',
      () => {
        expect(
          indexSource
        ).toContain(
          'TRM_UPDATE_SERVER_AUTHORITY'
        );

        const a =
          indexSource.indexOf(
            'exports.adminUpdateCycleTrmCallable'
          );

        const b =
          indexSource.indexOf(
            'CALLABLES DE INFORMES OFICIALES DE CIERRE',
            a
          );

        const segment =
          indexSource.slice(
            a,
            b
          );

        expect(
          segment
        ).not.toContain(
          'const { cycleId, newTrm'
        );

        expect(
          segment
        ).not.toContain(
          'Number(newTrm)'
        );

        expect(
          segment
        ).not.toContain(
          '|| 4028.5'
        );

        expect(
          segment
        ).toContain(
          'authoritativeTrm.rate'
        );
      }
    );


    it(
      'keeps market TRM automatic and closure TRM manual final',
      () => {
        // La operaci?n diaria contin?a siendo autoritativa desde
        // Dolar-Colombia en servidor.
        expect(
          indexSource
        ).toContain(
          'DOLAR_COLOMBIA_SERVER_AUTHORITY'
        );

        const a =
          indexSource.indexOf(
            'exports.adminCloseCycleCallable'
          );

        const b =
          indexSource.indexOf(
            'exports.adminUnlockCycleCallable',
            a
          );

        expect(
          a
        ).toBeGreaterThanOrEqual(0);

        expect(
          b
        ).toBeGreaterThan(a);

        const segment =
          indexSource.slice(
            a,
            b
          );

        // ?NICA excepci?n manual:
        // TRM definitiva introducida al cerrar el ciclo.
        expect(
          segment
        ).toContain(
          'CLOSING_TRM_MANUAL_FINAL_AUTHORITY'
        );

        expect(
          segment
        ).toContain(
          'Number(closingTrm)'
        );

        expect(
          segment
        ).toContain(
          'source: "MANUAL_SUPERADMIN"'
        );

        // Dolar-Colombia sigue consult?ndose al cerrar,
        // pero ?nicamente como referencia/auditor?a.
        expect(
          segment
        ).toContain(
          'fetchDolarColombiaTrm'
        );

        expect(
          segment
        ).toContain(
          'marketReferenceAtClose'
        );

        // Guardrail cr?tico:
        // la TRM autom?tica NO puede sustituir la manual de cierre.
        expect(
          segment
        ).not.toMatch(
          /parsedClosingTrm\s*=\s*authoritativeClosingTrm\.rate/
        );

        // La liquidaci?n definitiva sigue usando
        // USD acumulados ? TRM manual de cierre.
        expect(
          segment
        ).toContain(
          'const finalGrossCop = opUsd * parsedClosingTrm;'
        );
      }
    );


    it(
      'client update does not SEND newTrm',
      () => {
        const a =
          firestoreSource.indexOf(
            'async adminUpdateCycleTrm'
          );

        const signatureEnd =
          firestoreSource.indexOf(
            '  }) {',
            a
          );

        expect(
          signatureEnd
        ).toBeGreaterThan(
          a
        );

        const inputSignature =
          firestoreSource.slice(
            a,
            signatureEnd
          );

        expect(
          inputSignature
        ).not.toContain(
          'newTrm:'
        );
      }
    );


    it(
      'newTrm remains allowed as SERVER RESPONSE',
      () => {
        const a =
          firestoreSource.indexOf(
            'async adminUpdateCycleTrm'
          );

        const b =
          firestoreSource.indexOf(
            '// ==========================================',
            a
          );

        const segment =
          firestoreSource.slice(
            a,
            b
          );

        expect(
          segment
        ).toContain(
          'newTrm: number'
        );
      }
    );


    it(
      'closeCycle has no local TRM fallback',
      () => {
        const a =
          storeSource.indexOf(
            'public async closeCycle'
          );

        const b =
          storeSource.indexOf(
            '\n  /**',
            a + 10
          );

        const segment =
          storeSource.slice(
            a,
            b
          );

        expect(
          segment
        ).not.toContain(
          'effectiveClosingTrm'
        );

        expect(
          segment
        ).not.toContain(
          '4028.5'
        );

        expect(
          segment
        ).toContain(
          'SERVER_CLOSING_TRM_MISSING'
        );
      }
    );


    it(
      'frontend has no alternate FX providers',
      () => {
        expect(
          trmServiceSource
        ).not.toContain(
          'open.er-api.com'
        );

        expect(
          trmServiceSource
        ).not.toContain(
          'exchangerate-api.com'
        );

        expect(
          trmServiceSource
        ).not.toContain(
          'trm-colombia.vercel.app'
        );

        expect(
          trmServiceSource
        ).toContain(
          'getLiveTrmCallable'
        );
      }
    );

  }
);
