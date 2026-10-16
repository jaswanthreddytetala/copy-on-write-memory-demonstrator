const $ = id => document.getElementById(id);
let runnerReady = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setStatus(label, kind = '') {
  $('statusText').textContent = label;
  $('status').className = `status ${kind}`;
}

function clearTimeline() {
  document.querySelectorAll('.timeline-step').forEach(step => {
    step.classList.remove('current', 'complete');
  });
}

function resetDisplay() {
  setStatus(runnerReady ? 'Ready' : 'Linux runner unavailable', runnerReady ? '' : 'failed');
  $('parentPid').textContent = $('childPid').textContent = '—';
  $('parentValue').textContent = $('childValue').textContent = '—';
  $('parentState').textContent = $('childState').textContent = 'Waiting';
  $('memoryVisual').dataset.state = 'idle';
  $('memoryVisual').setAttribute('aria-label', 'Illustrative memory diagram, before execution');
  $('sharedValue').textContent = $('pageParentValue').textContent = $('pageChildValue').textContent = '—';
  $('diagramBadge').textContent = 'ILLUSTRATIVE MODEL';
  $('diagramNote').textContent = 'The diagram explains the usual Linux COW flow. It is not a page-table measurement.';
  $('resultBadge').textContent = 'NO RUN YET';
  $('resultSummary').textContent = runnerReady
    ? 'Run the demonstration to collect process values and available Linux memory accounting.'
    : 'The Linux runner is unavailable. Start the backend in Ubuntu or WSL2 to execute the real C program.';
  $('output').textContent = 'Run the demonstration to show the C program\'s output here.';
  $('statsGrid').innerHTML = '<article class="stat-card"><p class="stat-label">PARENT · AFTER CHILD WRITE</p><p class="stat-empty">No measurement yet</p></article><article class="stat-card"><p class="stat-label">CHILD · AFTER ITS WRITE</p><p class="stat-empty">No measurement yet</p></article>';
  clearTimeline();
}

async function checkRunner() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    runnerReady = response.ok && data.ready === true;
  } catch {
    runnerReady = false;
  }
  if (runnerReady) {
    $('diagramNote').textContent = 'The diagram is illustrative. Live process IDs, values, and smaps accounting appear after a real Linux run.';
    setStatus('Ready');
  } else {
    setStatus('Linux runner unavailable', 'failed');
    $('resultSummary').textContent = 'Open this dashboard from the local Linux backend and compile cow_demo to run the real demonstration.';
  }
}

function phaseFor(records, fragment) {
  return records?.find(record => record.label.includes(fragment))?.processes || {};
}

function renderStats(records) {
  const host = $('statsGrid');
  const phase = phaseFor(records, 'after child write');
  const fields = ['Rss', 'Pss', 'Shared_Dirty', 'Private_Dirty'];
  const labels = { Rss: 'Resident (RSS)', Pss: 'Proportional (PSS)', Shared_Dirty: 'Shared dirty', Private_Dirty: 'Private dirty' };
  host.replaceChildren();
  for (const [process, title] of [['parent', 'PARENT · AFTER CHILD WRITE'], ['child', 'CHILD · AFTER ITS WRITE']]) {
    const card = document.createElement('article');
    card.className = 'stat-card';
    const heading = document.createElement('p');
    heading.className = 'stat-label';
    heading.textContent = title;
    card.append(heading);
    const values = phase[process];
    if (!values || !Object.keys(values).length) {
      const missing = document.createElement('p');
      missing.className = 'stat-empty';
      missing.textContent = 'smaps_rollup was unavailable for this process.';
      card.append(missing);
    } else {
      const list = document.createElement('dl');
      list.className = 'stat-list';
      fields.filter(key => values[key] !== undefined).forEach(key => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const value = document.createElement('dd');
        term.textContent = labels[key];
        value.textContent = values[key];
        row.append(term, value);
        list.append(row);
      });
      card.append(list);
    }
    host.append(card);
  }
}

async function replayRun(output, data) {
  const initial = output.match(/Initial value at each page: (\d+)/)?.[1];
  const parentPid = output.match(/Parent PID: (\d+)/)?.[1] || data.parent_pid;
  const childPid = output.match(/Child PID: (\d+)/)?.[1] || data.child_pid;
  const childRead = output.match(/Child reads initial value: (\d+)/)?.[1];
  const parentRead = output.match(/Parent observes before child write: (\d+)/)?.[1];
  const modified = output.match(/Child modified \d+ page location\(s\); value now: (\d+)/)?.[1] || data.child_value;
  const parentFinal = output.match(/Parent value after child write: (\d+)/)?.[1] || data.parent_value;
  const stages = [
    Boolean(initial),
    Boolean(parentPid && childPid),
    Boolean(childRead && parentRead),
    Boolean(modified),
    Boolean(parentFinal)
  ];
  const steps = [...document.querySelectorAll('.timeline-step')];
  for (let index = 0; index < steps.length; index += 1) {
    if (!stages[index]) continue;
    const step = steps[index];
    step.classList.add('current');
    if (index === 0) {
      $('sharedValue').textContent = initial;
      $('parentValue').textContent = initial;
      $('parentState').textContent = 'Initialized';
    } else if (index === 1) {
      $('parentPid').textContent = parentPid || 'Unavailable';
      $('childPid').textContent = childPid || 'Unavailable';
      $('parentState').textContent = $('childState').textContent = 'Created by fork()';
    } else if (index === 2) {
      $('childValue').textContent = childRead;
      $('childState').textContent = 'Read initial value';
    } else if (index === 3) {
      $('childValue').textContent = modified;
      $('childState').textContent = 'Modified value';
      $('pageParentValue').textContent = parentRead || initial || '—';
      $('pageChildValue').textContent = modified;
      $('memoryVisual').dataset.state = 'split';
      $('memoryVisual').setAttribute('aria-label', 'Illustrative memory diagram, showing separate conceptual pages after the child write');
      $('diagramBadge').textContent = 'ILLUSTRATIVE COW MODEL';
      $('diagramNote').textContent = 'The C run confirmed different process values. Separate page boxes illustrate typical COW behavior; smaps totals do not verify these exact pages.';
    } else if (index === 4) {
      $('parentValue').textContent = parentFinal;
      $('parentState').textContent = 'Original retained';
      $('childState').textContent = 'Write completed';
    }
    await pause(420);
    step.classList.remove('current');
    step.classList.add('complete');
  }
}

async function runDemonstration() {
  const initialInput = $('initialValue');
  const childInput = $('childWriteValue');
  const initialValue = initialInput.valueAsNumber;
  const childValue = childInput.valueAsNumber;
  initialInput.setCustomValidity('');
  childInput.setCustomValidity('');
  if (!Number.isInteger(initialValue) || initialValue < 0 || initialValue > 255) {
    initialInput.setCustomValidity('Enter a whole number from 0 to 255.');
    initialInput.reportValidity();
    return;
  }
  if (!Number.isInteger(childValue) || childValue < 0 || childValue > 255) {
    childInput.setCustomValidity('Enter a whole number from 0 to 255.');
    childInput.reportValidity();
    return;
  }
  if (initialValue === childValue) {
    childInput.setCustomValidity('Choose a value different from the parent starting value.');
    childInput.reportValidity();
    return;
  }
  if (!runnerReady) {
    setStatus('Linux runner unavailable', 'failed');
    $('resultBadge').textContent = 'RUNNER UNAVAILABLE';
    $('resultSummary').textContent = 'The real C program needs the local Linux backend. No values or measurements were simulated.';
    return;
  }
  $('run').disabled = true;
  $('reset').disabled = true;
  clearTimeline();
  $('output').textContent = 'Running cow_demo and collecting Linux process observations…';
  setStatus('Running', 'running');
  $('resultBadge').textContent = 'RUNNING';
  $('resultSummary').textContent = 'Waiting for the parent and child processes to complete their synchronized memory checks.';
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: 1, initial_value: initialValue, child_value: childValue })
    });
    const data = await response.json();
    $('output').textContent = data.output || data.error || `Request failed (${response.status})`;
    if (!response.ok || !data.ok) {
      setStatus('Failed', 'failed');
      $('resultBadge').textContent = 'RUN FAILED';
      $('resultSummary').textContent = data.error || 'The C demonstration did not complete successfully.';
      return;
    }
    setStatus('Completed', 'done');
    $('resultBadge').textContent = 'COMPLETED';
    $('resultSummary').textContent = `Completed successfully. Parent PID ${data.parent_pid ?? '—'} retained ${data.parent_value ?? 'its original value'}; child PID ${data.child_pid ?? '—'} changed its value to ${data.child_value ?? 'a new value'}. The page diagram remains illustrative.`;
    renderStats(data.stats);
    await replayRun(data.output, data);
  } catch (error) {
    setStatus('Failed', 'failed');
    $('resultBadge').textContent = 'RUN FAILED';
    $('resultSummary').textContent = `Could not reach the local Linux runner: ${error.message}`;
    $('output').textContent = $('resultSummary').textContent;
  } finally {
    $('run').disabled = false;
    $('reset').disabled = false;
  }
}

$('run').addEventListener('click', runDemonstration);
$('reset').addEventListener('click', resetDisplay);
checkRunner();
