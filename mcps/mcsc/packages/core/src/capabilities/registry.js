import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * @param {import('./types.js').CliId} cliId
 * @param {import('./types.js').Tier} tier
 * @param {number} now
 * @returns {Promise<import('./types.js').ModelOffer | null>}
 */
export async function resolveOffer(cliId, tier, now) {
  if (cliId === 'agy') {
    try {
      const { stdout } = await execFileAsync('agy', ['models']);
      // Expected output format: 
      // Fetching available models...
      // gemini-3.8-flash-high   Gemini 3.8 Flash (High)
      const lines = stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('Fetching'));
      const models = lines.map(l => l.split(/\s+/)[0]);
      
      let selectedModel = null;
      if (tier === 'complex-code') {
        const claudes = models.filter(m => m.includes('claude'));
        if (claudes.length > 0) {
          selectedModel = claudes[0];
        } else {
          const proModels = models.filter(m => m.includes('pro'));
          if (proModels.length > 0) {
            selectedModel = proModels[0];
          }
        }
      } else if (['deep-research', 'quick-review', 'media-generation'].includes(tier)) {
        const flashes = models.filter(m => m.includes('flash'));
        if (flashes.length > 0) {
          selectedModel = flashes[0];
        }
      }

      if (!selectedModel && models.length > 0) {
        selectedModel = models[0];
      }

      if (selectedModel) {
        return {
          cliId,
          modelId: selectedModel,
          tier,
          resolvedAt: now,
          source: 'live-list'
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  if (cliId === 'opencode') {
    try {
      const { stdout } = await execFileAsync('opencode', ['models']);
      const lines = stdout.split('\n').map(l => l.trim());
      const opencodeFreeModels = lines.filter(l => l.startsWith('opencode/') && l.toLowerCase().includes('free'));
      
      let selectedModel = null;
      if (tier === 'complex-code') {
        selectedModel = opencodeFreeModels.find(m => m.includes('ultra') || m.includes('pro'));
      } else if (['deep-research', 'quick-review', 'media-generation'].includes(tier)) {
        selectedModel = opencodeFreeModels.find(m => m.includes('lightning') || m.includes('flash'));
      }

      let source = 'live-list';
      if (!selectedModel && opencodeFreeModels.length > 0) {
        // v1 heuristic fallback
        selectedModel = opencodeFreeModels[0];
        source = 'pinned'; 
      }

      if (selectedModel) {
        return {
          cliId,
          modelId: selectedModel,
          tier,
          resolvedAt: now,
          source
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  if (cliId === 'native' || cliId === 'codex') {
    return null;
  }

  return null;
}
