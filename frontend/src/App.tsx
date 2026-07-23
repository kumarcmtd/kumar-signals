import { Routes, Route } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AITest } from "./pages/AITest";
import { AITestPro } from "./pages/AITestPro";
import { AITestElite } from "./pages/AITestElite";
import { TradeReport } from "./pages/TradeReport";
import { KimiAITrade } from "./pages/KimiAITrade";
import { Dashboard } from "./pages/Dashboard";
import { Charts } from "./pages/Charts";
import { Options } from "./pages/Options";
import { Risk } from "./pages/Risk";
import { Global } from "./pages/Global";
import { Journal } from "./pages/Journal";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <AppShell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<AITest />} />
          <Route path="/ai-test-pro" element={<AITestPro />} />
          <Route path="/ai-elite" element={<AITestElite />} />
          <Route path="/trade-report" element={<TradeReport />} />
          <Route path="/kimi-ai-trade" element={<KimiAITrade />} />
          <Route path="/prices" element={<Dashboard />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/options" element={<Options />} />
          <Route path="/risk" element={<Risk />} />
          <Route path="/global" element={<Global />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

export default App;
