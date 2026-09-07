const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const panel = read('src/modules/shared/ui/ProfessionalWorkContinuityPanel.tsx');
const residentHome = read('src/modules/shared/ui/IntelligenceHarnessHome.tsx');
const doctorHome = read('src/modules/doctors/components/DoctorHomeView.tsx');
const app = read('src/App.tsx');

const checks = [
  {
    name: 'continuity panel defines the three required lanes',
    pass: ['Cases and follow-up', 'Dissertation and research', 'Professional record / learning']
      .every((text) => panel.includes(text)),
  },
  {
    name: 'continuity panel uses existing registered routes only',
    pass: [
      '/doctor/cases',
      '/casebook-logbook',
      '/research',
      '/workspace/dissertation',
      '/workspace/library',
      '/workspace/consultant-review',
      '/my-record',
      '/workspace/exam-readiness',
      '/workspace/viva-simulator',
    ].every((text) => panel.includes(text)),
  },
  {
    name: 'resident home wires the generic continuity panel',
    pass: residentHome.includes('<ProfessionalWorkContinuityPanel') &&
      residentHome.includes('canOpenCaseCapture={hasAuthenticatedSession}') &&
      !residentHome.includes('OLANIPEKUN_WORKFORCE_ID'),
  },
  {
    name: 'doctor home wires the generic continuity panel',
    pass: doctorHome.includes('<ProfessionalWorkContinuityPanel') &&
      doctorHome.includes("kind: 'doctor'") &&
      doctorHome.includes('canOpenCaseCapture'),
  },
  {
    name: 'Dr Olanipekun is not hardcoded in product client logic for this slice',
    pass: ![panel, residentHome, doctorHome].some((source) => /Olanipekun|5e3491aa-dfbd-430a-a131-89a5a8e4a704/.test(source)),
  },
  {
    name: 'honest unavailable states are disabled, not fake connected claims',
    pass: panel.includes('disabledReason') &&
      panel.includes('Summary unavailable') &&
      panel.includes('No dissertation record or research workspace is visible yet.') &&
      panel.includes('No casebook workspaces or submitted case reports are visible yet.'),
  },
  {
    name: 'no raw Drive URL or clinical identifier pattern is exposed by the continuity panel',
    pass: !/drive\.google|docs\.google|hospital_number|patient_initials|storage_path|document_url/.test(panel),
  },
  {
    name: 'linked doctor resident session keeps the real tenant id',
    pass: app.includes('tenant_id: linkedWorkforce.tenant_id'),
  },
];

const failures = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
