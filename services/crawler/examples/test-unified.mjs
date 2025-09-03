#!/usr/bin/env node

// Example: Test Unified Crawler with all modes
import { runUnifiedCrawler } from '../unified-crawler.mjs';
import path from 'path';

const testSites = [
  {
    name: 'GitHub',
    url: 'https://github.com',
    modes: ['legacy', 'enhanced', 'hybrid']
  },
  {
    name: 'Example',
    url: 'https://example.com',
    modes: ['legacy', 'enhanced']
  }
];

async function testAllModes() {
  console.log('🧪 Testing Unified Crawler - All Modes\n');
  
  for (const site of testSites) {
    console.log(`🌐 Testing site: ${site.name} (${site.url})`);
    
    for (const mode of site.modes) {
      console.log(`  📋 Mode: ${mode}`);
      
      const outputFile = path.join(process.cwd(), 'snapshots', 
        `${site.name.toLowerCase()}-${mode}.json`);
      
      try {
        const startTime = Date.now();
        const result = await runUnifiedCrawler(site.url, outputFile, {
          mode,
          maxDepth: mode === 'enhanced' ? 2 : 1,
          maxInteractions: 5,
          suggest: true,
          waitMs: 2000
        });
        const duration = Date.now() - startTime;
        
        console.log(`    ✅ Success! (${duration}ms)`);
        
        if (mode === 'enhanced') {
          console.log(`       📊 States: ${result.states?.length || 0}`);
          console.log(`       🎯 Elements: ${result.crawlMetadata?.totalElements || 0}`);
        } else if (mode === 'legacy') {
          console.log(`       🎯 Elements: ${result.elements?.length || 0}`);
          console.log(`       🔑 Shortcuts: ${result.nativeShortcuts?.length || 0}`);
        } else if (mode === 'hybrid') {
          console.log(`       📊 States: ${result.enhanced?.states?.length || 0}`);
          console.log(`       🎯 Total Elements: ${result.combined?.totalElements || 0}`);
        }
        
        console.log(`       📁 Output: ${outputFile}`);
        
      } catch (error) {
        console.log(`    ❌ Failed: ${error.message}`);
      }
    }
    console.log('');
  }
  
  console.log('🎉 Unified crawler testing complete!');
}

// Performance comparison
async function performanceComparison() {
  console.log('⚡ Performance Comparison\n');
  
  const testUrl = 'https://github.com';
  const results = {};
  
  for (const mode of ['legacy', 'enhanced', 'hybrid']) {
    console.log(`🏃 Testing ${mode} mode...`);
    
    try {
      const startTime = Date.now();
      const result = await runUnifiedCrawler(testUrl, 
        path.join(process.cwd(), 'snapshots', `perf-${mode}.json`), {
        mode,
        maxDepth: mode === 'legacy' ? 1 : 2,
        maxInteractions: 5,
        suggest: false // Skip suggestions for performance test
      });
      const duration = Date.now() - startTime;
      
      results[mode] = {
        duration,
        elements: mode === 'enhanced' ? result.crawlMetadata?.totalElements :
                 mode === 'legacy' ? result.elements?.length :
                 result.combined?.totalElements,
        states: mode === 'enhanced' ? result.states?.length :
               mode === 'hybrid' ? result.enhanced?.states?.length : 1
      };
      
      console.log(`  ✅ ${duration}ms - ${results[mode].elements} elements, ${results[mode].states} states`);
      
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      results[mode] = { error: error.message };
    }
  }
  
  console.log('\n📊 Performance Summary:');
  Object.entries(results).forEach(([mode, data]) => {
    if (data.error) {
      console.log(`  ${mode}: ❌ ${data.error}`);
    } else {
      console.log(`  ${mode}: ${data.duration}ms | ${data.elements} elements | ${data.states} states`);
    }
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--perf')) {
    await performanceComparison();
  } else {
    await testAllModes();
  }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(console.error);
}

export { testAllModes, performanceComparison };
