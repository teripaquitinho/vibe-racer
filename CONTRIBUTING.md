# Contributing to vibe-racer

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/teripaquitinho/vibe-racer.git
cd vibe-racer
npm install
npm run build
npm link  # makes `vibe-racer` available globally
```

## Development Workflow

```bash
npm run dev -- <command>    # run CLI without building (e.g., npm run dev -- pitwall)
npm run test:watch          # run tests in watch mode
npm run lint                # lint source code
npm run typecheck           # type-check without emitting
npm run build               # build to dist/
```

## Code Style

- TypeScript strict mode, ESM only
- ESLint for linting (run `npm run lint`)
- No default exports
- Prefer explicit types over inference for public APIs

## Testing

- Tests use [vitest](https://vitest.dev/)
- Test files live alongside source in `tests/` mirroring the `src/` structure
- Mock external dependencies (Claude SDK, git, filesystem) in tests
- Run `npm run test` before submitting a PR

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes with tests
4. Ensure all checks pass: `npm run lint && npm run typecheck && npm run test`
5. Commit with a descriptive message
6. Open a Pull Request against `main`

## Reporting Issues

Use [GitHub Issues](https://github.com/teripaquitinho/vibe-racer/issues) for bug reports and feature requests.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.
