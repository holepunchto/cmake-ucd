include_guard()

set(
  ucd_version 17.0.0
  CACHE STRING
  "The version of the Unicode Character Database to generate character tables from"
)

# The directory that fetched data files are written to. This sits in the top-level
# build tree rather than that of whichever project fetched them, so that several
# projects in the one build share both the files and the version above. A library
# generating tables from one version while a library it is used alongside generates
# them from another is a difference that no build error would catch.
set(
  ucd_data "${CMAKE_BINARY_DIR}/_ucd/${ucd_version}"
  CACHE INTERNAL "The directory holding the fetched Unicode Character Database files"
)

# Checks that a data file declares the version that was asked of it, which the
# files of the database state in a `# Version:` line of their header. This is what
# makes it safe to fall back to an unversioned path: the file has to say for itself
# which version it holds.
function(ucd_check_version path name url)
  file(
    STRINGS "${path}" declared
    LIMIT_COUNT 1
    REGEX "^#[ \t]*Version:[ \t]*[0-9]+\\.[0-9]+\\.[0-9]+"
  )

  if(NOT declared MATCHES "([0-9]+\\.[0-9]+\\.[0-9]+)")
    message(WARNING "${name} declares no version, so cannot be checked against ${ucd_version}")

    return()
  endif()

  if(CMAKE_MATCH_1 VERSION_EQUAL ucd_version)
    return()
  endif()

  # Leave nothing behind that a later configure would take for a good file.
  file(REMOVE "${path}")

  message(
    FATAL_ERROR
    "${url} holds version ${CMAKE_MATCH_1} of ${name}, not the ${ucd_version} that was asked for. "
    "Set ucd_version to a version that the data is published for."
  )
endfunction()

# Fetches the named files of a collection of the Unicode Character Database,
# writing them to `${ucd_data}`. A file that has already been fetched is left
# alone, the data of a released version never changing.
#
# The collection names the part of <https://www.unicode.org/Public> to take the
# files from:
#
#   UCD         The character database proper, such as UnicodeData.txt.
#   EXTRACTED   The properties extracted from it, such as DerivedBidiClass.txt.
#   IDNA        The IDNA data, such as IdnaMappingTable.txt.
#
# The IDNA data is versioned separately from the database and is not always given a
# directory of its own version: at the time of writing the numbered directories
# stop at 16.0.0 while the 17.0.0 data is published under `latest`. Both are
# therefore tried, and a file taken from `latest` is checked to declare the version
# that was asked for rather than trusted to be it.
#
# The absolute paths of the files are appended to the variable named by PATHS, for
# a caller to depend on from the command that reads them.
function(ucd_fetch collection)
  cmake_parse_arguments(PARSE_ARGV 1 ARGV "" "PATHS" "")

  if(collection STREQUAL "UCD")
    set(bases "${ucd_version}/ucd")
  elseif(collection STREQUAL "EXTRACTED")
    set(bases "${ucd_version}/ucd/extracted")
  elseif(collection STREQUAL "IDNA")
    set(bases "idna/${ucd_version}" "idna/latest")
  else()
    message(FATAL_ERROR "Unknown Unicode Character Database collection \"${collection}\"")
  endif()

  if(NOT ARGV_UNPARSED_ARGUMENTS)
    message(FATAL_ERROR "No files given to fetch from the ${collection} collection")
  endif()

  # A collection whose path names the version cannot hold another, so only one
  # that has a fallback has to be checked.
  list(LENGTH bases base_count)

  if(base_count GREATER 1)
    set(check ON)
  else()
    set(check OFF)
  endif()

  set(paths)

  foreach(name IN LISTS ARGV_UNPARSED_ARGUMENTS)
    set(path "${ucd_data}/${name}")

    list(APPEND paths "${path}")

    if(EXISTS "${path}")
      continue()
    endif()

    set(fetched OFF)
    set(reasons)

    foreach(base IN LISTS bases)
      set(url "https://www.unicode.org/Public/${base}/${name}")

      file(DOWNLOAD "${url}" "${path}" STATUS status)

      list(GET status 0 code)

      if(code EQUAL 0)
        if(check)
          ucd_check_version("${path}" "${name}" "${url}")
        endif()

        set(fetched ON)

        break()
      endif()

      list(GET status 1 reason)

      list(APPEND reasons "${url}: ${reason}")

      file(REMOVE "${path}")
    endforeach()

    if(NOT fetched)
      list(JOIN reasons "\n  " detail)

      message(FATAL_ERROR "Could not download ${name}:\n  ${detail}")
    endif()
  endforeach()

  if(DEFINED ARGV_PATHS)
    list(APPEND ${ARGV_PATHS} ${paths})

    return(PROPAGATE ${ARGV_PATHS})
  endif()
endfunction()
