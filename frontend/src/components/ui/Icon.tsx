import { ComponentProps, FC } from 'react'
import * as TablerIcons from '@tabler/icons-react'

type TablerIconName = keyof typeof TablerIcons

interface IconProps extends Omit<ComponentProps<'svg'>, 'ref' | 'stroke' | 'color'> {
  name: TablerIconName
  size?: number
  stroke?: number
  color?: string
}

export const Icon: FC<IconProps> = ({
  name,
  size = 20,
  stroke = 1.5,
  color = 'currentColor',
  ...props
}) => {
  const IconComponent = TablerIcons[name] as FC<{
    size?: number
    stroke?: number
    color?: string
    className?: string
  }>

  if (!IconComponent) {
    console.warn(`[Icon] Unknown icon: "${name}"`)
    return <TablerIcons.IconQuestionMark size={size} stroke={stroke} color="red" />
  }

  return <IconComponent size={size} stroke={stroke} color={color} {...props} />
}
