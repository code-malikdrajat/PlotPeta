// Logika Utama PlotPeta (TypeScript)
console.log("PlotPeta App Running...");

interface LocationPlot {
    id: string;
    title: string;
    latitude: number;
    longitude: number;
}

const initApp = () => {
    console.log("Inisialisasi PlotPeta...");
};

document.addEventListener("DOMContentLoaded", initApp);
