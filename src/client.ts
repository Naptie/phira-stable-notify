const API_URL = 'https://phira.5wyxi.com/chart/stable-requests';

export const getRecentRequests = async (
  thresholds: { approvals: number; denials: number },
  withinMillis: number | undefined = 60 * 1000
) => {
  const charts: Array<{
    chart: {
      id: number;
      name: string;
      level: string;
      updated: string;
      file: string;
    };
    approvedBy: string[];
    deniedBy: string[];
  }> = [];
  let page = 1;
  let total = 0;
  let accumulated = 0;
  const now = Date.now();
  const hasTimeLimit =
    withinMillis !== undefined && !Number.isNaN(withinMillis) && withinMillis > 0;

  while (
    total === 0 ||
    (accumulated < total &&
      (!hasTimeLimit ||
        now - new Date(charts.at(-1)?.chart.updated ?? 0).getTime() <= withinMillis))
  ) {
    console.log(`[NapCat] Fetching page ${page}...`);
    const response = await fetch(`${API_URL}?page=${page++}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }
    const { count, results } = (await response.json()) as {
      count: number;
      results: typeof charts;
    };
    total = count;
    accumulated += results.length;

    charts.push(
      ...results.filter((req) => {
        const approvedCount = req.approvedBy.length;
        const deniedCount = req.deniedBy.length;
        if (
          !(isNaN(thresholds.approvals) || approvedCount === 0) &&
          approvedCount < thresholds.approvals
        )
          return false;
        if (!(isNaN(thresholds.denials) || deniedCount === 0) && deniedCount < thresholds.denials)
          return false;
        const updatedTime = new Date(req.chart.updated).getTime();
        if (
          withinMillis !== undefined &&
          !isNaN(withinMillis) &&
          withinMillis > 0 &&
          now - updatedTime > withinMillis
        )
          return false;
        return true;
      })
    );
  }
  return charts;
};
