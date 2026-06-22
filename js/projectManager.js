/**
 * projectManager.js — Project save/load/delete (local, no login)
 */

import { saveProject, loadProject, listProjects, deleteProject } from './storage.js';

let _currentProjectId = null;
let _onProjectsChange = null;

export function initProjectManager(onChangeFn) {
  _onProjectsChange = onChangeFn;
}

export function getCurrentProjectId() { return _currentProjectId; }

export async function createProject(name) {
  const id = 'proj_' + Date.now();
  const proj = {
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    layerIds: [],
    mapState: null
  };
  await saveProject(proj);
  _currentProjectId = id;
  await refreshList();
  return proj;
}

export async function saveCurrentProject(mapState, layerIds) {
  if (!_currentProjectId) return null;
  const proj = await loadProject(_currentProjectId);
  if (!proj) return null;

  proj.mapState  = mapState;
  proj.layerIds  = layerIds;
  proj.updatedAt = Date.now();
  await saveProject(proj);
  return proj;
}

export async function openProject(id) {
  const proj = await loadProject(id);
  if (!proj) return null;
  _currentProjectId = id;
  return proj;
}

export async function removeProject(id) {
  await deleteProject(id);
  if (_currentProjectId === id) _currentProjectId = null;
  await refreshList();
}

export async function getAllProjects() {
  const projects = await listProjects();
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function refreshList() {
  if (_onProjectsChange) {
    const projects = await getAllProjects();
    _onProjectsChange(projects);
  }
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
