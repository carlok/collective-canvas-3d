// Server → Client messages
export interface AssignedMsg {
  type: 'assigned'
  id: string
  color: string
  name: string
}

export interface GoLiveMsg {
  type: 'go_live'
}

export interface StopMsg {
  type: 'stop'
}

export interface ErrorMsg {
  type: 'error'
  message: string
}

export interface ParticipantCountMsg {
  type: 'participant_count'
  count: number
}

export interface StateChangeMsg {
  type: 'state_change'
  phase: 'lobby' | 'live'
}

export interface AuthenticatedMsg {
  type: 'authenticated'
  phase: 'lobby' | 'live'
  participant_count: number
}

export interface ParticipantSnapshot {
  id: string
  color: string
  x: number
  y: number
  z: number
  drawing: boolean
}

export interface SnapshotMsg {
  type: 'snapshot'
  participants: ParticipantSnapshot[]
}

// Client → Server messages
export interface PositionMsg {
  type: 'position'
  alpha: number
  beta: number
  gamma: number
  drawing: boolean
}

export interface AuthMsg {
  type: 'auth'
  password: string
}

export interface AdminCommandMsg {
  type: 'go_live' | 'stop'
}

// Internal WebSocket connection events (not from server)
export interface WsConnectedMsg {
  type: '_connected'
}

export interface WsDisconnectedMsg {
  type: '_disconnected'
}

export type ServerMsg = AssignedMsg | GoLiveMsg | StopMsg | ErrorMsg | ParticipantCountMsg | StateChangeMsg | AuthenticatedMsg | SnapshotMsg | WsConnectedMsg | WsDisconnectedMsg
