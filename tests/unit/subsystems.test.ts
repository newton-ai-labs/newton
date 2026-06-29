/**
 * Subsystem detection across project templates.
 *
 * The constellation's color coding only feels right if a JS, Python, Go,
 * or Rails project all get sensible labels. This test pins a representative
 * file from each common layout to its expected subsystem id.
 */
import { describe, it, expect } from 'vitest'
import { subsystemFor } from '../../src/components/constellation/subsystems'

function id(path: string): string { return subsystemFor(path).id }

describe('subsystemFor — multi-stack', () => {
  it('classifies Next.js / React + Tailwind project paths', () => {
    expect(id('src/components/Button.tsx')).toBe('ui')
    expect(id('src/hooks/useAuth.ts')).toBe('hooks')
    expect(id('app/dashboard/page.tsx')).toBe('ui')
    expect(id('pages/api/login.ts')).toBe('server')
    expect(id('app/api/users/route.ts')).toBe('server')
    expect(id('src/store/cartSlice.ts')).toBe('stores')
    expect(id('tailwind.config.js')).toBe('config')
    expect(id('tsconfig.json')).toBe('config')
    expect(id('package.json')).toBe('config')
    expect(id('src/lib/utils.ts')).toBe('utils')
    expect(id('public/logo.svg')).toBe('assets')
    expect(id('styles/globals.css')).toBe('styles')
    expect(id('types/api.d.ts')).toBe('types')
  })

  it('classifies a Node/Express backend project', () => {
    expect(id('src/server/index.ts')).toBe('server')
    expect(id('src/controllers/user.ts')).toBe('server')
    expect(id('src/routes/auth.ts')).toBe('server')
    expect(id('src/services/email.ts')).toBe('services')
    expect(id('src/models/User.ts')).toBe('models')
    expect(id('prisma/schema.prisma')).toBe('models')
    expect(id('prisma/migrations/0001_init/migration.sql')).toBe('migrations')
  })

  it('classifies a Python (Django/Flask/FastAPI) project', () => {
    expect(id('app/views.py')).toBe('server')        // matches main|app|server|index *.py at root of app/
    expect(id('app/main.py')).toBe('server')
    expect(id('app/api/users.py')).toBe('server')
    expect(id('app/services/email.py')).toBe('services')
    expect(id('app/models/user.py')).toBe('models')
    expect(id('app/migrations/0001_initial.py')).toBe('migrations')
    expect(id('app/templates/index.html')).toBe('ui')
    expect(id('app/static/css/main.css')).toBe('styles')
    expect(id('app/static/js/app.js')).toBe('assets')
    expect(id('tests/test_users.py')).toBe('tests')
    expect(id('app/tests/test_views.py')).toBe('tests')
    expect(id('pyproject.toml')).toBe('config')
    expect(id('requirements.txt')).toBe('config')
    expect(id('alembic/versions/abc_init.py')).toBe('migrations')
  })

  it('classifies a Go module', () => {
    expect(id('cmd/server/main.go')).toBe('server')
    expect(id('internal/handlers/user.go')).toBe('server')
    expect(id('internal/services/email.go')).toBe('services')
    expect(id('internal/models/user.go')).toBe('models')
    expect(id('pkg/utils/strings.go')).toBe('utils')
    expect(id('internal/handlers/user_test.go')).toBe('tests')
    expect(id('go.mod')).toBe('config')
    expect(id('configs/dev.yaml')).toBe('config')
  })

  it('classifies a Rust crate', () => {
    expect(id('src/main.rs')).toBe('src')
    expect(id('src/lib.rs')).toBe('src')
    expect(id('src/models/user.rs')).toBe('models')
    expect(id('src/services/auth.rs')).toBe('services')
    expect(id('tests/integration.rs')).toBe('tests')
    expect(id('Cargo.toml')).toBe('config')
  })

  it('classifies a Ruby on Rails app', () => {
    expect(id('app/controllers/users_controller.rb')).toBe('server')
    expect(id('app/models/user.rb')).toBe('models')
    expect(id('app/views/users/index.html.erb')).toBe('ui')
    expect(id('app/services/billing_service.rb')).toBe('services')
    expect(id('app/jobs/welcome_email_job.rb')).toBe('services')
    expect(id('db/migrate/20240101_create_users.rb')).toBe('migrations')
    expect(id('config/routes.rb')).toBe('config')
    expect(id('spec/models/user_spec.rb')).toBe('tests')
    expect(id('test/models/user_test.rb')).toBe('tests')
    expect(id('Gemfile')).toBe('config')
  })

  it('classifies a Java/Spring Maven project', () => {
    expect(id('src/main/java/com/x/controller/UserController.java')).toBe('server')
    expect(id('src/main/java/com/x/service/UserService.java')).toBe('services')
    expect(id('src/main/java/com/x/entity/User.java')).toBe('models')
    expect(id('src/test/java/com/x/UserTest.java')).toBe('tests')
    expect(id('pom.xml')).toBe('config')
    expect(id('build.gradle')).toBe('config')
  })

  it('classifies docs, scripts, mobile, i18n', () => {
    expect(id('docs/architecture.md')).toBe('docs')
    expect(id('README.md')).toBe('docs')
    expect(id('scripts/build.sh')).toBe('scripts')
    expect(id('bin/cli.js')).toBe('scripts')
    expect(id('android/app/build.gradle')).toBe('mobile')
    expect(id('ios/MyApp/Info.plist')).toBe('mobile')
    expect(id('locales/en.json')).toBe('i18n')
    expect(id('src/i18n/messages.ts')).toBe('i18n')
  })

  it('falls back to root for unrecognized paths', () => {
    expect(id('totallyrandom.xyz')).toBe('root')
    expect(id('weird/place/thing.rs')).toBe('root')
  })

  it("does not categorize Newton's own paths as 'root'", () => {
    // Sanity: this project still works as well as before.
    expect(id('server/index.ts')).toBe('server')
    expect(id('src/App.tsx')).toBe('src')
    expect(id('src/components/EditorArea.tsx')).toBe('ui')
    expect(id('src/themes.css')).toBe('styles')
    expect(id('src/themes/registry.ts')).toBe('themes')
    expect(id('shared/types.ts')).toBe('utils')
    expect(id('tests/unit/patchBlocks.test.ts')).toBe('tests')
    expect(id('docs/THEMING.md')).toBe('docs')
    expect(id('vite.config.ts')).toBe('config')
  })
})
