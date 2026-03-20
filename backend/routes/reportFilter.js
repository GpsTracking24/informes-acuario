function buildReportFilter(reportType = "speed") {
  switch (reportType) {

    // 🔵 EXCESO DE VELOCIDAD
    case "speed":
      return {
        whereSql: "AND e.code_event BETWEEN ? AND ?",
        params: [149, 170]
      };

    case "hard_accel":
      return {
        whereSql: "AND e.code_event = ?",
        params: [171]
      };
    case "hard_brake":
      return {
        whereSql: "AND e.code_event = ?",
        params: [172]
      };

    default:
      return { whereSql: "", params: [] };
  }
}

module.exports = { buildReportFilter };