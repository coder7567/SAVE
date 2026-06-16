#!/usr/bin/env python3
"""
RUT_TRAILBLAZER Convoy Mode WebSockets
Real-time telemetry and messaging coordinator for groups/convoys.
"""

import logging
from typing import Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("RUT_Convoy_WS")

router = APIRouter(tags=["Convoy"])

class ConnectionManager:
    def __init__(self):
        # Format: { convoy_id: { client_id: WebSocket } }
        self.active_convoys: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, convoy_id: str, client_id: str, websocket: WebSocket):
        await websocket.accept()
        if convoy_id not in self.active_convoys:
            self.active_convoys[convoy_id] = {}
        self.active_convoys[convoy_id][client_id] = websocket
        logger.info(f"Client {client_id} connected to Convoy {convoy_id}.")

    def disconnect(self, convoy_id: str, client_id: str):
        if convoy_id in self.active_convoys:
            if client_id in self.active_convoys[convoy_id]:
                del self.active_convoys[convoy_id][client_id]
                logger.info(f"Client {client_id} disconnected from Convoy {convoy_id}.")
            if not self.active_convoys[convoy_id]:
                del self.active_convoys[convoy_id]

    async def broadcast(self, convoy_id: str, sender_id: str, payload: Dict[str, Any]):
        """
        Relays coordinates and chat message updates to all active convoy members except the sender.
        """
        if convoy_id not in self.active_convoys:
            return
        
        # Inject sender identifier
        payload["sender_id"] = sender_id
        
        targets = self.active_convoys[convoy_id]
        for client_id, connection in list(targets.items()):
            if client_id != sender_id:
                try:
                    await connection.send_json(payload)
                except Exception as e:
                    logger.error(f"Error broadcasting to client {client_id}: {e}")
                    # Clean up broken connection
                    self.disconnect(convoy_id, client_id)

manager = ConnectionManager()

@router.websocket("/api/convoy/{convoy_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, convoy_id: str, client_id: str):
    await manager.connect(convoy_id, client_id, websocket)
    try:
        # Keep connection alive, listen for updates
        while True:
            # Expecting JSON structure: { "latitude": float, "longitude": float, "chat_message": str (optional) }
            data = await websocket.receive_json()
            
            # Broadcast update
            await manager.broadcast(convoy_id, client_id, data)
            
    except WebSocketDisconnect:
        manager.disconnect(convoy_id, client_id)
        # Notify remaining convoy members of client departure
        await manager.broadcast(convoy_id, client_id, {
            "event": "disconnect",
            "message": f"Client {client_id} has left the convoy."
        })
    except Exception as e:
        logger.error(f"WebSocket error in Convoy {convoy_id} for client {client_id}: {e}")
        manager.disconnect(convoy_id, client_id)
