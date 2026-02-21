import React, { useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ToolCallInfo } from '../types'

interface Props {
  readonly toolCall: ToolCallInfo
  readonly isDark: boolean
}

const STATUS_LABELS: Record<ToolCallInfo['status'], string> = {
  running: 'Läuft...',
  done: 'Fertig',
  error: 'Fehler',
}

const STATUS_COLORS: Record<ToolCallInfo['status'], string> = {
  running: '#ff9800',
  done: '#4caf50',
  error: '#f44336',
}

export function ToolExecutionCard({ toolCall, isDark }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(!expanded)}>
        <Text style={[styles.toolName, isDark && styles.textDark]}>{toolCall.name}</Text>
        <Text style={[styles.status, { color: STATUS_COLORS[toolCall.status] }]}>
          {STATUS_LABELS[toolCall.status]}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.details}>
          <Text style={[styles.detailLabel, isDark && styles.detailLabelDark]}>Argumente:</Text>
          <Text style={[styles.detailText, isDark && styles.detailTextDark]}>
            {JSON.stringify(toolCall.args, null, 2)}
          </Text>

          {toolCall.result !== undefined && (
            <>
              <Text style={[styles.detailLabel, isDark && styles.detailLabelDark]}>Ergebnis:</Text>
              <Text style={[styles.detailText, isDark && styles.detailTextDark]}>
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  containerDark: {
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
  },
  toolName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  status: {
    fontSize: 12,
    fontWeight: '500',
  },
  details: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    marginTop: 4,
  },
  detailLabelDark: {
    color: '#888',
  },
  detailText: {
    fontSize: 12,
    color: '#555',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  detailTextDark: {
    color: '#aaa',
  },
  textDark: {
    color: '#e0e0e0',
  },
})
