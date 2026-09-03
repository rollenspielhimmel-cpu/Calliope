import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'
import FailureLogReporter from './scripts/failureLog.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: import.meta.dirname,
      // `default` keeps the terminal exactly as it was; the second one appends any failure's name
      // to ../test-failures.log, so a run that fails once and passes on the next try still leaves
      // the one thing an investigation needs. Here rather than behind a flag: nothing to remember,
      // and it covers watch mode too.
      reporters: ['default', new FailureLogReporter()],
    },
  }),
)
