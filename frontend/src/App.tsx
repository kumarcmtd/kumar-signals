import { Routes, Route } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AITest } from "./pages/AITest";
import { AITestPro } from "./pages/AITestPro";
import { AITestElite } from "./pages/AITestElite";
import { TradeReport } from "./pages/TradeReport";
import { KimiAITrade } from "./pages/KimiAITrade";
import { MarketAnalysis } from "./pages/MarketAnalysis";
import { KumarAI } from "./pages/KumarAI";
import { CEBuySignals, PEBuySignals } from "./pages/DirectionalSignals";
import { AiShoot } from "./pages/AiShoot";
import { Dashboard } from "./pages/Dashboard";
import { Charts } from "./pages/Charts";
import { Options } from "./pages/Options";
import { Risk } from "./pages/Risk";
import { Global } from "./pages/Global";
import { Journal } from "./pages/Journal";
import { Alerts } from "./pages/Alerts";
import { Settings } from "./pages/Settings";
import { AiLearn } from "./pages/AiLearn";
import { BestCall } from "./pages/BestCall";
import { AiRisk } from "./pages/AiRisk";
import { AiSuperTrendPro } from "./pages/AiSuperTrendPro";
import { AiStrategyVerification } from "./pages/AiStrategyVerification";
import { AiVerifyPro } from "./pages/AiVerifyPro";
import { NewsBasedTradeAi } from "./pages/NewsBasedTradeAi";
import { AiTwentyTwenty } from "./pages/AiTwentyTwenty";
import { LevelCrossScan } from "./pages/LevelCrossScan";
import { AiOwn } from "./pages/AiOwn";
import { AiUp } from "./pages/AiUp";

function App() {
  return (
    <AppShell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<AiShoot />} />
          <Route path="/ai-test-v2" element={<AITest />} />
          <Route path="/ai-test-pro" element={<AITestPro />} />
          <Route path="/ai-elite" element={<AITestElite />} />
          <Route path="/trade-report" element={<TradeReport />} />
          <Route path="/kimi-ai-trade" element={<KimiAITrade />} />
          <Route path="/market-analysis" element={<MarketAnalysis />} />
          <Route path="/kumar-ai" element={<KumarAI />} />
          <Route path="/ce-buy-signals" element={<CEBuySignals />} />
          <Route path="/pe-buy-signals" element={<PEBuySignals />} />
          <Route path="/prices" element={<Dashboard />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/options" element={<Options />} />
          <Route path="/risk" element={<Risk />} />
          <Route path="/global" element={<Global />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/ai-learn" element={<AiLearn />} />
          <Route path="/best-call" element={<BestCall />} />
          <Route path="/ai-risk" element={<AiRisk />} />
          <Route path="/ai-supertrend-pro" element={<AiSuperTrendPro />} />
          <Route path="/ai-strategy-verification" element={<AiStrategyVerification />} />
          <Route path="/ai-verify-pro" element={<AiVerifyPro />} />
          <Route path="/news-trade-ai" element={<NewsBasedTradeAi />} />
          <Route path="/ai-20-20" element={<AiTwentyTwenty />} />
          <Route path="/level-cross-scan" element={<LevelCrossScan />} />
          <Route path="/ai-own" element={<AiOwn />} />
          <Route path="/ai-up" element={<AiUp />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

export default App;
