# Contributing to F.R.I.D.A.Y.

We welcome contributions! This guide will help you get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Documentation](#documentation)
- [Community](#community)

## Development Setup

### Prerequisites

- Node.js 20 LTS or later
- pnpm (recommended) or npm
- Git

### First Time Setup

```bash
# Clone the repository
git clone https://github.com/MacCracken/FRIDAY.git
cd friday

# Install dependencies
pnpm install

# Set required environment variables
export SECUREYEOMAN_SIGNING_KEY="your-signing-key-at-least-32-chars"
export SECUREYEOMAN_TOKEN_SECRET="your-token-secret-at-least-32-chars"
export SECUREYEOMAN_ENCRYPTION_KEY="your-encryption-key-at-least-32-chars"
export SECUREYEOMAN_ADMIN_PASSWORD="your-admin-password-at-least-32-chars"
export ANTHROPIC_API_KEY="sk-ant-..."

# Start development server
pnpm dev
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm test --workspace=@friday/core

# Run tests with coverage
pnpm test -- --coverage
```

## Code Style

We use automated tools to maintain consistent code quality:

```bash
# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check
```

### Style Guidelines

- Use TypeScript strict mode
- Follow ESLint rules
- Use Prettier for formatting
- Write meaningful commit messages
- Include tests for new features

## Testing

### Test Structure

```
packages/
├── shared/
│   └── src/
│       └── *.test.ts
├── core/
│   └── src/
│       └── *.test.ts
└── dashboard/
    └── src/
        └── *.test.ts
```

### Running Tests

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# E2E tests
pnpm test:e2e

# Watch mode
pnpm test -- --watch
```

### Test Coverage

- Aim for 80%+ coverage on new code
- Test critical paths and error cases
- Use descriptive test names

## Submitting Changes

### Branching Strategy

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/your-feature-name
```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks

### Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Update documentation
6. Submit a pull request
7. Request code review

### PR Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass
- [ ] Documentation updated
- [ ] PR description explains changes
- [ ] Breaking changes documented

## Documentation

### Documentation Structure

```
docs/
├── api/                    # API documentation
├── guides/                 # User guides
├── security/              # Security documentation
└── development/           # Development docs
```

### Writing Documentation

- Use clear, concise language
- Include code examples
- Add cross-references
- Update TOC for new sections
- Review for accuracy

## Community

### Getting Help

- [GitHub Issues](https://github.com/MacCracken/FRIDAY/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/MacCracken/FRIDAY/discussions) - Questions and community chat

### Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) and follow it in all interactions.

### Security

For security issues, please see our [Security Policy](SECURITY.md).

## Development Phases

See our [Roadmap](../development/roadmap.md) for current development priorities and phases.

## Additional Resources

- [Architecture Overview](../development/architecture.md)
- [API Reference](../api/)
- [Security Model](../security/security-model.md)
- [Deployment Guide](../guides/deployment.md)

Thank you for contributing to F.R.I.D.A.Y.!