// projectManager.js - BorneoGIS Project Management
const ProjectManager = (() => {
  let currentProject = null;

  function generateId() {
    return `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async function createProject(name = 'Proyek Baru') {
    const project = {
      id: generateId(),
      name,
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mapCenter: [-0.7893, 113.9213],
      mapZoom: 6,
      crs: 'EPSG:4326',
      metadata: { author: '', organization: '', notes: '' }
    };
    await Storage.put(Storage.STORES.PROJECTS, project);
    currentProject = project;
    return project;
  }

  async function openProject(id) {
    const project = await Storage.get(Storage.STORES.PROJECTS, id);
    if (!project) throw new Error('Proyek tidak ditemukan');
    currentProject = project;
    return project;
  }

  async function saveProject(updates = {}) {
    if (!currentProject) throw new Error('Tidak ada proyek aktif');
    Object.assign(currentProject, updates, { updatedAt: new Date().toISOString() });
    await Storage.put(Storage.STORES.PROJECTS, currentProject);
    return currentProject;
  }

  async function deleteProject(id) {
    await Storage.remove(Storage.STORES.PROJECTS, id);
    const layers = await Storage.getByIndex(Storage.STORES.LAYERS, 'projectId', id);
    for (const l of layers) await Storage.remove(Storage.STORES.LAYERS, l.id);
    const waypoints = await Storage.getByIndex(Storage.STORES.WAYPOINTS, 'projectId', id);
    for (const w of waypoints) await Storage.remove(Storage.STORES.WAYPOINTS, w.id);
    const tracks = await Storage.getByIndex(Storage.STORES.TRACKS, 'projectId', id);
    for (const t of tracks) await Storage.remove(Storage.STORES.TRACKS, t.id);
    if (currentProject && currentProject.id === id) currentProject = null;
  }

  async function getAllProjects() {
    return Storage.getAll(Storage.STORES.PROJECTS);
  }

  async function backupProject(id) {
    const project = await Storage.get(Storage.STORES.PROJECTS, id);
    if (!project) throw new Error('Proyek tidak ditemukan');
    const layers = await Storage.getByIndex(Storage.STORES.LAYERS, 'projectId', id);
    const waypoints = await Storage.getByIndex(Storage.STORES.WAYPOINTS, 'projectId', id);
    const tracks = await Storage.getByIndex(Storage.STORES.TRACKS, 'projectId', id);
    const analysis = await Storage.getByIndex(Storage.STORES.ANALYSIS, 'projectId', id);

    const backup = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      project, layers, waypoints, tracks, analysis
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_backup.bgis`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restoreProject(file) {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.version || !backup.project) throw new Error('File backup tidak valid');

    backup.project.id = generateId();
    backup.project.name += ' (Restored)';
    backup.project.updatedAt = new Date().toISOString();
    await Storage.put(Storage.STORES.PROJECTS, backup.project);

    const idMap = { [backup.project.id]: backup.project.id };

    for (const layer of (backup.layers || [])) {
      const newLayer = { ...layer, id: `lyr_${Date.now()}_${Math.random().toString(36).substr(2,6)}`, projectId: backup.project.id };
      await Storage.put(Storage.STORES.LAYERS, newLayer);
    }
    for (const wp of (backup.waypoints || [])) {
      const newWp = { ...wp, id: `wp_${Date.now()}_${Math.random().toString(36).substr(2,6)}`, projectId: backup.project.id };
      await Storage.put(Storage.STORES.WAYPOINTS, newWp);
    }
    for (const track of (backup.tracks || [])) {
      const newTrack = { ...track, id: `trk_${Date.now()}_${Math.random().toString(36).substr(2,6)}`, projectId: backup.project.id };
      await Storage.put(Storage.STORES.TRACKS, newTrack);
    }
    return backup.project;
  }

  function getCurrent() { return currentProject; }
  function setCurrent(p) { currentProject = p; }

  return {
    createProject,
    openProject,
    saveProject,
    deleteProject,
    getAllProjects,
    backupProject,
    restoreProject,
    getCurrent,
    setCurrent
  };
})();

window.ProjectManager = ProjectManager;
