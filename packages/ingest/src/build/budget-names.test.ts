import { expect, it } from 'vitest';
import { budget2027Codes, nameBudget2027 } from './budget-names.js';

it('uses codes for both bill variants, handles the inserted article and reports missing entries', () => {
  const ministries = [
    { id: '1300', art: 12, name: 'Министерство на вътрешните работи' },
    { id: '3800', art: 32, name: 'Национална служба за охрана' },
  ];
  expect(budget2027Codes(ministries)).toEqual({ '12': '1300', '33': '3800' });
  const variant = () => ({
    '1': { name: 'Държавен бюджет' },
    '12': { name: 'Министерството на вътрешните работи', rows: [{ value: 123 }] },
    '32': { name: 'Комисията за противодействие на корупцията' },
    '99': { name: 'Орган без запис' },
    '33': { name: 'Националната служба за охрана' },
  });
  const budget = { budgets: { bill: variant(), billMc: variant() }, municipal: {} };
  nameBudget2027(budget, ministries, []);
  for (const items of Object.values(budget.budgets)) {
    expect(items['12'].name).toBe(ministries[0]!.name);
    expect(items['12'].rows).toEqual([{ value: 123 }]);
    expect(items['33'].name).toBe(ministries[1]!.name);
    expect(items['32'].name).toBe('Комисия за противодействие на корупцията');
    expect(items['32']).not.toHaveProperty('nameNote');
    expect(items['99']).toMatchObject({
      name: 'Орган без запис',
      nameNote: expect.stringContaining('Няма запис'),
    });
  }
});

it('resolves municipal aliases and duplicate names by region, preserving cells', () => {
  const municipalities = [
    { id: 'SOF46', name: 'Столична', lawName: 'СТОЛИЧНА ОБЩИНА', region: 'София (столица)' },
    { id: 'DOB15', name: 'Добрич-селска', lawName: 'Добричка', region: 'Добрич' },
    { id: 'AAA01', name: 'Тест', region: 'Първа' },
    { id: 'BBB01', name: 'Тест', region: 'Втора' },
  ];
  const rows = () => [
    { name: 'Столична община', region: 'ОБЛАСТ СОФИЯ (СТОЛИЦА)', cells: [{ value: 123 }] },
    { name: 'Тест', region: 'ОБЛАСТ ВТОРА', cells: [] },
    { name: 'Добричка', region: 'ОБЛАСТ ДОБРИЧ', cells: [] },
    { name: 'Липсваща', region: 'ОБЛАСТ ПЪРВА', cells: [] },
  ];
  const budget = { budgets: {}, municipal: { art52: rows(), art53: rows() } };
  nameBudget2027(budget, [], municipalities);
  for (const items of Object.values(budget.municipal)) {
    expect(items[0]).toEqual({
      name: 'Столична община',
      region: 'ОБЛАСТ СОФИЯ (СТОЛИЦА)',
      cells: [{ value: 123 }],
    });
    expect(items[1]!.name).toBe('Тест');
    expect(items[2]!.name).toBe('Добричка');
    expect(items[3]).toHaveProperty('nameNote');
  }
  expect(() =>
    nameBudget2027(
      { budgets: {}, municipal: { art52: [{ name: 'Тест', region: 'Неизвестна' }] } },
      [],
      municipalities,
    ),
  ).toThrow('Ambiguous');
});
