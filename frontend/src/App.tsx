import { Routes, Route } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AITrade } from "./pages/AITrade";
import { AI3V } from "./pages/AI3V";
import { Dashboard } from "./pages/Dashboard";
import { Charts } from "./pages/Charts";
import { Options } from "./pages/Options";
import { Risk } from "./pages/Risk";
import { Global } from "./pages/Global";
import { MasterAI } from "./pages/MasterAI";
import { Journal } from "./pages/Journal";
import { Settings } from "./pages/Settings";

function App() {
  return (
    <AppShell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<AITrade />} />
          <Route path="/ai-3v" element={<AI3V />} />
          <Route path="/prices" element={<Dashboard />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/options" element={<Options />} />
          <Route path="/risk" element={<Risk />} />
          <Route path="/global" element={<Global />} />
          <Route path="/master-ai" element={<MasterAI />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}

export default App;
