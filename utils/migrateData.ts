export const runMigrationIfNeeded = (data: any) => {
  if (!data || typeof data !== 'object') return data;
  if (!data.exchangeRates) {
    data.exchangeRates = { USD: 0, JPY: 0 };
  }
  return data;
};
