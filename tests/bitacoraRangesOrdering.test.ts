import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  BITACORA_RANGES,
  getCategoryForCapital,
  validateCapitalForCategory,
} from '../src/lib/financialEngine';

describe(
  'canonical bitacora ranges',
  () => {
    it(
      'uses exact boundaries',
      () => {
        expect(
          validateCapitalForCategory(
            1_999_999,
            'AZUL'
          )
        ).toBe(false);

        expect(
          getCategoryForCapital(
            2_000_000
          )
        ).toBe('AZUL');

        expect(
          getCategoryForCapital(
            9_999_999
          )
        ).toBe('AZUL');

        expect(
          getCategoryForCapital(
            10_000_000
          )
        ).toBe('VERDE');

        expect(
          getCategoryForCapital(
            59_999_999
          )
        ).toBe('VERDE');

        expect(
          getCategoryForCapital(
            60_000_000
          )
        ).toBe('NEGRA');

        expect(
          getCategoryForCapital(
            500_000_000
          )
        ).toBe('NEGRA');
      }
    );

    it(
      'exports canonical ranges',
      () => {
        expect(
          BITACORA_RANGES.AZUL.min
        ).toBe(2_000_000);

        expect(
          BITACORA_RANGES.AZUL.max
        ).toBe(9_999_999);

        expect(
          BITACORA_RANGES.VERDE.min
        ).toBe(10_000_000);

        expect(
          BITACORA_RANGES.VERDE.max
        ).toBe(59_999_999);

        expect(
          BITACORA_RANGES.NEGRA.min
        ).toBe(60_000_000);

        expect(
          BITACORA_RANGES.NEGRA.max
        ).toBe(
          Number.MAX_SAFE_INTEGER
        );
      }
    );

    it(
      'keeps backend aligned',
      () => {
        const index =
          fs.readFileSync(
            path.join(
              process.cwd(),
              'functions',
              'index.js'
            ),
            'utf8'
          );

        expect(index).toContain(
          'if (cap >= 60000000)'
        );

        expect(index).toContain(
          'if (cap >= 10000000)'
        );

        expect(index).toContain(
          'finalCapitalCop < 2000000'
        );

        expect(index).toContain(
          'BITACORA_BOUNDARY_LEGACY_COMPAT'
        );

        expect(index).toContain(
          'CUSTOM_GROUP_MIN_CAPITAL'
        );

        expect(index).toContain(
          'Number(groupCapitalCop) < 2000000'
        );

        expect(index).toContain(
          'ADMIN_CREATE_USER_CAPITAL_GUARD'
        );

        expect(index).toContain(
          'ADMIN_CREATE_PENDING_INVESTOR_CAPITAL_GUARD'
        );

        expect(index).toContain(
          'frozenLegacyBoundaryMatch'
        );

        expect(index).toContain(
          'trueLegacyCycleBoundaryMatch'
        );
      }
    );

    it(
      'keeps ascending-order guards',
      () => {
        const store =
          fs.readFileSync(
            path.join(
              process.cwd(),
              'src',
              'lib',
              'dataStore.ts'
            ),
            'utf8'
          );

        const admin =
          fs.readFileSync(
            path.join(
              process.cwd(),
              'src',
              'components',
              'AdminBitacoraView.tsx'
            ),
            'utf8'
          );

        const report =
          fs.readFileSync(
            path.join(
              process.cwd(),
              'functions',
              'cycleReports.js'
            ),
            'utf8'
          );

        expect(store).toContain(
          'BITACORA_USERS_CAPITAL_ASC'
        );

        expect(admin).toContain(
          'BITACORA_OPERATED_USERS_CAPITAL_ASC'
        );

        expect(report).toContain(
          'BITACORA_REPORT_CAPITAL_ASC'
        );
      }
    );
  }
);
